// Runs on your own biz.yelp.com Reviews page.
//
// What it does:  match approved replies from the Review Desk to the review
// cards on screen, add an "Insert approved reply" button to each match, fill
// the comment box when clicked, and mark the item posted once the reply
// actually appears on the page.
//
// What it never does: click Send. Yelp requires a human for that, and the
// entire design of the Review Desk depends on that line staying bright.

(() => {
  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

  // ── Page parsing (mirrors scripts/scrape_reviews.js — update both) ────────
  const starEls = () =>
    [...document.querySelectorAll('[aria-label$="star rating"]')].filter((e) =>
      /^[1-5] star rating$/.test(e.getAttribute('aria-label'))
    );

  function cardOf(starEl) {
    let card = starEl;
    for (let i = 0; i < 12 && card; i++) {
      card = card.parentElement;
      if (card && card.querySelector('[class*="passport-container"]')) break;
    }
    return card;
  }

  function parseCard(starEl) {
    const card = cardOf(starEl);
    if (!card) return null;
    const passport = card.querySelector('[class*="passport-container"]');
    const name = passport?.querySelector('span')?.textContent?.trim() || '?';
    const rating = parseInt(starEl.getAttribute('aria-label'));
    const date = card.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/)?.[1] || '';
    let text = '';
    for (const p of card.querySelectorAll('p, span')) {
      if (passport && passport.contains(p)) continue;
      const t = p.textContent.trim();
      if (t.length > text.length && !/^Thank$|^Comment$|^Direct message$/.test(t)) text = t;
    }
    const answered = /you (publicly )?responded|business response/i.test(card.textContent);
    return { card, name, rating, date, answered, text };
  }

  // ── Matching desk items to cards ──────────────────────────────────────────
  // Name alone collides (the queue really has the same reviewer twice), so the
  // key is name+rating+date; consumed items are struck off so duplicates match
  // one card each, in order.
  function matchKey(name, rating, date) {
    return `${name}|${rating}|${date}`;
  }

  function itemKey(item) {
    const date = (item.subject || '').match(/\((\d{1,2}\/\d{1,2}\/\d{2,4})\)/)?.[1] || '';
    return matchKey(item.reviewer_name, item.rating, date);
  }

  // ── Filling the comment box ───────────────────────────────────────────────
  function setReactValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function insertReply(parsed, item, button) {
    const commentBtn = [...parsed.card.querySelectorAll('button, a')].find(
      (b) => b.textContent.trim() === 'Comment'
    );
    if (commentBtn) commentBtn.click();
    // Wait for Yelp to render the box.
    for (let i = 0; i < 20; i++) {
      const ta = parsed.card.querySelector('textarea');
      if (ta) {
        setReactValue(ta, item.effective_reply);
        button.textContent = 'Filled — press Send (↑)';
        button.style.background = '#1a7f4b';
        watchForPost(parsed, item, button);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    button.textContent = 'Could not open comment box';
  }

  // After the human presses Send, Yelp re-renders the card with the comment in
  // it and drops the textarea. That state change — not our button click — is
  // what marks the item posted, so the desk only records what actually landed.
  function watchForPost(parsed, item, button) {
    const snippet = item.effective_reply.slice(0, 40);
    const obs = new MutationObserver(async () => {
      const boxGone = !parsed.card.querySelector('textarea');
      const replyShown = parsed.card.textContent.includes(snippet);
      if (boxGone && replyShown) {
        obs.disconnect();
        const res = await send({ kind: 'markPosted', id: item.gmail_id });
        button.textContent = res.ok ? 'Posted ✓ (synced to desk)' : `Posted, sync failed: ${res.error}`;
        button.disabled = true;
      }
    });
    obs.observe(parsed.card, { childList: true, subtree: true, characterData: true });
    setTimeout(() => obs.disconnect(), 10 * 60 * 1000);
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function makeButton(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'margin:6px 0 0;padding:6px 14px;border-radius:999px;border:none;cursor:pointer;' +
      'background:#0a7cff;color:#fff;font:600 13px system-ui;display:block';
    return b;
  }

  function banner(text) {
    let el = document.getElementById('__deskBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = '__deskBanner';
      el.style.cssText =
        'position:fixed;bottom:18px;right:18px;z-index:99999;background:#14161a;color:#fff;' +
        'padding:10px 16px;border-radius:10px;font:500 13px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.35)';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  async function run() {
    // Optional label attached to re-ingested reviews. Useful when one Review
    // Desk serves several listings; blank is fine and the desk falls back to
    // whatever the listing header on the page says.
    const businessName = (await send({ kind: 'getBusinessName' }))?.data || '';
    const res = await send({ kind: 'getApproved' });
    if (!res.ok) {
      banner(`Review Desk: ${res.error}`);
      return;
    }
    const items = res.data.items || [];
    const unclaimed = new Map(); // key -> [items]
    for (const it of items) {
      const k = itemKey(it);
      if (!unclaimed.has(k)) unclaimed.set(k, []);
      unclaimed.get(k).push(it);
    }

    let matched = 0;
    const seenForIngest = [];
    for (const s of starEls()) {
      const parsed = parseCard(s);
      if (!parsed) continue;
      if (parsed.text.length > 15) {
        seenForIngest.push({
          source_id: null, // filled below — hash needs the same recipe as the server scripts
          reviewer_name: parsed.name,
          rating: parsed.rating,
          date: parsed.date,
          text: parsed.text,
          answered: parsed.answered,
        });
      }
      if (parsed.answered) continue;
      const k = matchKey(parsed.name, parsed.rating, parsed.date);
      const queue = unclaimed.get(k);
      if (!queue || !queue.length) continue;
      const item = queue.shift();
      matched++;
      const btn = makeButton('Insert approved reply');
      btn.addEventListener('click', () => insertReply(parsed, item, btn));
      // Place the button under the Thank/Comment row.
      const row = [...parsed.card.querySelectorAll('button, a')].find(
        (b) => b.textContent.trim() === 'Comment'
      );
      (row?.parentElement || parsed.card).appendChild(btn);
    }

    banner(
      matched
        ? `Review Desk: ${matched} approved repl${matched === 1 ? 'y' : 'ies'} ready — blue buttons below each review`
        : `Review Desk: no approved replies match the reviews on screen (${items.length} approved total)`
    );

    // Passive re-scrape of whatever is visible: keeps the desk's queue fresh
    // without anyone remembering to run the scraper. sha1 of name|date|text
    // must match scripts/ingest_scraped.py so dedupe holds across both paths.
    const enc = new TextEncoder();
    const unanswered = seenForIngest.filter((r) => !r.answered);
    for (const r of unanswered) {
      const digest = await crypto.subtle.digest(
        'SHA-1',
        enc.encode(`${r.reviewer_name}|${r.date}|${r.text.slice(0, 80)}`)
      );
      r.source_id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      r.review_url = location.href.split('?')[0];
      if (businessName) r.business_name = businessName;
      delete r.answered; // page-side field; the ingest API doesn't take it
    }
    if (unanswered.length) {
      const ing = await send({ kind: 'ingest', reviews: unanswered });
      if (ing.ok && ing.data.ingested > 0) {
        banner(`Review Desk: found ${ing.data.ingested} new review(s) — drafting now, check the desk shortly`);
      }
    }
  }

  // Yelp renders late; give the page a moment, then re-run when it mutates heavily.
  setTimeout(run, 2500);
})();
