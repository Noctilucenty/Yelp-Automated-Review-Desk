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

  // Yelp paginates: the Reviews page renders roughly the ten most recent and
  // hides the rest behind "Load more". Without this the desk only ever learns
  // about page one, which looks exactly like "no new reviews" — reviews sit
  // unanswered indefinitely and nothing reports an error. Both predicates are
  // deliberately narrow (exact-ish label matches on pagination controls only);
  // this runs unattended on page load, so it must never click anything that
  // changes state.
  async function expandAll(onProgress) {
    const click = (pred) => {
      let n = 0;
      for (const b of document.querySelectorAll('button,a')) {
        if (pred(b.textContent.trim().toLowerCase())) {
          b.click();
          n++;
        }
      }
      return n;
    };
    for (let page = 0; page < 10; page++) {
      if (!click((t) => t.startsWith('load more'))) break;
      onProgress?.(page + 2);
      await new Promise((r) => setTimeout(r, 2500));
    }
    // Expand truncated bodies, or the desk ingests "…" and drafts from a stub.
    click((t) => t === 'read more');
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Yelp concatenates the date onto whatever precedes it ("3 reviews7/21/26"),
  // so there is no word boundary to anchor on — and an unbounded match then
  // steals a neighbouring digit. Both failure modes are in the live database:
  // "68/4/23" (a leading digit from a count) and "7/13/235" (a trailing one).
  // Repair rather than reject: an impossible month or a three-digit year is
  // exactly one stolen character, and which end it came from is unambiguous.
  function cardDate(text) {
    for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g)) {
      let [, mo, d, y] = m;
      if (+mo > 12 && mo.length === 2) mo = mo[1];
      if (y.length === 3) y = y.slice(0, 2);
      if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${mo}/${d}/${y}`;
    }
    return '';
  }

  function parseCard(starEl) {
    const card = cardOf(starEl);
    if (!card) return null;
    const passport = card.querySelector('[class*="passport-container"]');
    const name = passport?.querySelector('span')?.textContent?.trim() || '?';
    const rating = parseInt(starEl.getAttribute('aria-label'));
    const date = cardDate(card.textContent);
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
  // Name alone collides (the queue really does hold the same reviewer twice —
  // Tina S. wrote two separate 1-star reviews), so the key needs a third part.
  //
  // That part used to be the card date, which was a mistake: the date is scraped
  // out of concatenated DOM text and picks up neighbouring digits, so the desk
  // holds values like "7/13/235" and "68/4/23". It happened to work only because
  // both sides ran the identical buggy regex.
  //
  // The review's own opening is a far better discriminator: it is the thing that
  // actually distinguishes two reviews by the same person, it needs no parsing,
  // and it cannot drift between the page and the desk because the desk stored it
  // from this same extraction. Normalised so whitespace changes cannot break it.
  function textKey(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
  }

  function matchKey(name, rating, text) {
    return `${name}|${rating}|${textKey(text)}`;
  }

  function itemKey(item) {
    return matchKey(item.reviewer_name, item.rating, item.review_text);
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
        // Track edits so the desk records what was actually posted rather than
        // what was suggested — that difference is the only real measure of how
        // good the drafts are.
        const edits = { text: item.effective_reply };
        ta.addEventListener('input', () => {
          edits.text = ta.value;
        });
        button.textContent = item.needsReview
          ? 'Filled — READ IT, edit, then press Send (↑)'
          : 'Filled — press Send (↑)';
        button.style.background = item.needsReview ? BTN.review.bg : '#1a7f4b';
        watchForPost(parsed, item, button, edits);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    button.textContent = 'Could not open comment box';
  }

  // After the human presses Send, Yelp re-renders the card with the comment in
  // it and drops the textarea. That state change — not our button click — is
  // what marks the item posted, so the desk only records what actually landed.
  function watchForPost(parsed, item, button, edits) {
    const obs = new MutationObserver(async () => {
      const boxGone = !parsed.card.querySelector('textarea');
      // Match on what the human actually sent, not the original draft — an
      // edited reply is still a posted reply.
      const snippet = (edits.text || item.effective_reply).trim().slice(0, 40);
      const replyShown = snippet.length > 10 && parsed.card.textContent.includes(snippet);
      if (boxGone && replyShown) {
        obs.disconnect();
        const res = await send({
          kind: 'markPosted',
          id: item.gmail_id,
          final_reply: edits.text,
        });
        button.textContent = res.ok ? 'Posted ✓ (synced to desk)' : `Posted, sync failed: ${res.error}`;
        button.style.background = '#1a7f4b';
        button.disabled = true;
      }
    });
    obs.observe(parsed.card, { childList: true, subtree: true, characterData: true });
    setTimeout(() => obs.disconnect(), 10 * 60 * 1000);
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  // Two visual states, because they mean genuinely different things:
  //   ready  (blue)   — cleared by the auto-approve policy or by a human. Post it.
  //   review (orange) — a draft nobody has approved. The desk held it back for a
  //                     reason: low rating, an escalation keyword, or a possible
  //                     Terms-of-Service problem. Read and edit before sending.
  const BTN = {
    ready: { bg: '#0a7cff', label: 'Insert approved reply' },
    review: { bg: '#e07b12', label: 'Insert draft — needs your review' },
  };

  function makeButton(variant) {
    const b = document.createElement('button');
    b.textContent = BTN[variant].label;
    b.style.cssText =
      'margin:6px 0 0;padding:6px 14px;border-radius:999px;border:none;cursor:pointer;' +
      'background:' + BTN[variant].bg + ';color:#fff;font:600 13px system-ui;display:block';
    return b;
  }

  // Spells out WHY the desk held this one back, so the warning is actionable
  // rather than just a colour.
  function makeWarning(item) {
    const reasons = [];

    // The desk's own escalation reasons are the most specific thing we have.
    // They already state the rating rule, so don't repeat it separately.
    for (const r of item.escalate_reasons || []) {
      // Strip the "model: " prefix and clip the model's rationale — the point
      // is to prompt a read, not to reproduce the analysis inline.
      const clean = String(r).replace(/^model:\s*/, '');
      reasons.push(clean.length > 90 ? clean.slice(0, 90).trimEnd() + '…' : clean);
    }
    if ((item.tos_flags || []).length) {
      reasons.push('possible Terms-of-Service issue — consider reporting rather than replying');
    }
    if (!reasons.length && item.draft_confidence && item.draft_confidence !== 'high') {
      reasons.push('draft confidence: ' + item.draft_confidence);
    }
    if (!reasons.length) reasons.push('not yet approved by anyone');

    const d = document.createElement('div');
    const head = document.createElement('strong');
    head.textContent = 'Read before sending. ';
    d.appendChild(head);
    // textContent, never innerHTML: review text and model output are untrusted.
    d.appendChild(document.createTextNode(reasons.join(' · ')));
    d.style.cssText =
      'margin:6px 0 0;padding:7px 11px;border-radius:8px;font:500 12px/1.45 system-ui;' +
      'background:#fff4e5;color:#7a4b00;border:1px solid #f0b357;max-width:620px';
    return d;
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

    // Load every page BEFORE matching, so buttons and ingest both see the whole
    // history rather than the first screen.
    banner('Review Desk: loading your full review history…');
    await expandAll((p) => banner(`Review Desk: loading page ${p} of reviews…`));

    // Both buckets, so every unanswered review on the page gets a button:
    //   approved — cleared to post (blue)
    //   pending  — drafted but deliberately held back for a human (orange)
    const [appRes, penRes] = await Promise.all([
      send({ kind: 'getQueue', status: 'approved' }),
      send({ kind: 'getQueue', status: 'pending' }),
    ]);
    if (!appRes.ok) {
      banner(`Review Desk: ${appRes.error}`);
      return;
    }
    const approved = (appRes.data.items || []).map((i) => ({ ...i, needsReview: false }));
    const pending = penRes.ok ? (penRes.data.items || []).map((i) => ({ ...i, needsReview: true })) : [];
    const items = [...approved, ...pending];

    const unclaimed = new Map(); // key -> [items]
    for (const it of items) {
      const k = itemKey(it);
      if (!unclaimed.has(k)) unclaimed.set(k, []);
      unclaimed.get(k).push(it);
    }
    // If a review somehow sits in both buckets, prefer the approved one — a
    // human already signed off on that text.
    for (const list of unclaimed.values()) list.sort((a, b) => a.needsReview - b.needsReview);

    let matched = 0;
    let needsReview = 0;
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
      const k = matchKey(parsed.name, parsed.rating, parsed.text);
      const queue = unclaimed.get(k);
      if (!queue || !queue.length) continue;
      const item = queue.shift();
      matched++;
      if (item.needsReview) needsReview++;

      const btn = makeButton(item.needsReview ? 'review' : 'ready');
      btn.addEventListener('click', () => insertReply(parsed, item, btn));

      // Place the button under the Thank/Comment row.
      const row = [...parsed.card.querySelectorAll('button, a')].find(
        (b) => b.textContent.trim() === 'Comment'
      );
      const host = row?.parentElement || parsed.card;
      if (item.needsReview) {
        const warn = makeWarning(item);
        if (warn) host.appendChild(warn);
      }
      host.appendChild(btn);
    }

    const ready = matched - needsReview;
    banner(
      matched
        ? `Review Desk: ${matched} drafted — ${ready} approved (blue), ${needsReview} need your review (orange)`
        : `Review Desk: nothing on screen matches the queue (${items.length} drafted in total)`
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
      if (!ing.ok) {
        banner(`Review Desk: could not reach the desk to check for new reviews — ${ing.error}`);
      } else if ((ing.data.errors || []).length) {
        // Loud on purpose. Drafting failing for every review looks exactly like
        // "nothing new" if you only report successes, and the most likely cause
        // — an exhausted OpenAI quota — silently stops the whole pipeline.
        const first = String(ing.data.errors[0]);
        const quota = /insufficient_quota|exceeded your current quota|429/i.test(first);
        banner(
          quota
            ? 'Review Desk: drafting FAILED — the OpenAI account is out of quota. New reviews will not get drafts until it is topped up.'
            : `Review Desk: ${ing.data.errors.length} review(s) failed to draft — ${first.slice(0, 120)}`
        );
      } else if (ing.data.ingested > 0) {
        banner(
          `Review Desk: drafted ${ing.data.ingested} new review(s) — reload this page to get their buttons`
        );
      }
    }
  }

  // Yelp renders late; give the page a moment, then re-run when it mutates heavily.
  setTimeout(run, 2500);
})();
