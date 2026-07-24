// Service worker: all Review Desk API traffic lives here.
//
// Two reasons this is not done in the content script:
//  1. CORS — the desk API sets no CORS headers, and it shouldn't have to. A
//     service-worker fetch with host_permissions bypasses page CORS entirely.
//  2. The token — it stays in chrome.storage and in this worker; the content
//     script (which runs inside Yelp's page) never sees it.

// ── First-run setup ─────────────────────────────────────────────────────────
// A distributor can drop a `config.json` next to this file to ship a build that
// works the moment it is installed — no options screen, nothing to paste:
//
//     { "deskUrl": "https://your-desk.onrender.com", "deskToken": "…" }
//
// That file is deliberately NOT in version control: it carries a token that
// grants full access to the desk. Public builds omit it and fall back to
// opening the options page so the user knows what is missing.

async function seedFromBundledConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    if (!res.ok) return false;
    const cfg = await res.json();
    const patch = {};
    for (const k of ['deskUrl', 'deskToken', 'businessName']) {
      if (cfg[k]) patch[k] = String(cfg[k]).trim();
    }
    if (!Object.keys(patch).length) return false;
    // Never clobber a value the user has already set by hand.
    const current = await chrome.storage.sync.get({ deskUrl: '', deskToken: '' });
    if (current.deskUrl && current.deskToken) return true;
    await chrome.storage.sync.set(patch);
    return Boolean(patch.deskUrl && patch.deskToken);
  } catch {
    return false; // no config.json bundled — normal for public builds
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const ready = await seedFromBundledConfig();
  if (!ready) chrome.runtime.openOptionsPage();
});

async function settings() {
  const s = await chrome.storage.sync.get({ deskUrl: '', deskToken: '' });
  if (!s.deskUrl || !s.deskToken) throw new Error('Set the desk URL and token in the extension options.');
  return { base: s.deskUrl.replace(/\/+$/, ''), token: s.deskToken };
}

async function api(path, body) {
  const { base, token } = await settings();
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Dashboard-Token': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Desk API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.kind === 'getBusinessName') {
        const s = await chrome.storage.sync.get({ businessName: '' });
        sendResponse({ ok: true, data: s.businessName });
      } else if (msg.kind === 'getApproved') {
        // Approved = a human (or the auto-approve policy) signed off; these are
        // the only replies this extension will ever offer to insert.
        sendResponse({ ok: true, data: await api('/api/queue?status=approved&limit=100') });
      } else if (msg.kind === 'markPosted') {
        sendResponse({
          ok: true,
          data: await api(`/api/item/${encodeURIComponent(msg.id)}/decision`, {
            status: 'posted',
            reviewed_by: 'extension',
          }),
        });
      } else if (msg.kind === 'ingest') {
        // Passive re-scrape: whatever reviews were visible on the page get
        // pushed to the desk. Idempotent server-side, so this is free to spam.
        sendResponse({ ok: true, data: await api('/api/ingest', { reviews: msg.reviews }) });
      } else {
        sendResponse({ ok: false, error: `unknown message kind: ${msg.kind}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
