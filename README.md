# Review Desk Helper

A Chrome extension that pre-fills your approved review replies on your own
**Yelp for Business** Reviews page, and marks them posted once they land.

**It never clicks Send.** Yelp has no public API for posting review replies, so
the last action is always a human pressing Yelp's own button. This extension
removes the copy-paste and the bookkeeping around that click — nothing more.

---

## What it does

On `biz.yelp.com/r2r/*`:

1. **Fetches your drafted replies** from a Review Desk you run — both the
   approved ones and the ones still awaiting review — and matches them to the
   reviews on screen by reviewer name, rating and date.
2. **Adds a button under every unanswered review**, colour-coded by state:

   | | Meaning | Button |
   |---|---|---|
   | **Blue** | Approved — by a human or by your desk's auto-approve policy | *Insert approved reply* |
   | **Orange** | Drafted but deliberately held back | *Insert draft — needs your review* |

   Orange rows also carry an inline note naming **why** the desk held it back:
   the escalation reasons, a possible Terms-of-Service problem, or low draft
   confidence. After insertion the orange button reads *READ IT, edit, then
   press Send* rather than the blue path's plain *press Send*.

3. **You press Send.** Always. For both colours.
4. **Marks the item posted** in your Review Desk — only once the reply actually
   appears on the page, so the desk records what landed rather than what was
   attempted. Your edits are captured too, so the desk stores the text you
   really published, not the suggestion.
5. **Passively re-ingests your whole review history**, so simply visiting the
   page keeps your queue current. This matters: Yelp's notification emails are
   truncated and skip most reviews, so email alone under-fills any queue.
   Newly ingested reviews need one more page load before their button appears.

   On each visit it walks Yelp's *Load more* pagination (up to ten pages) and
   expands truncated bodies before scanning, so reviews below the first screen
   are seen too. That takes a few seconds — the status pill in the corner tells
   you which page it is on. Reviews the desk already knows are skipped cheaply,
   so a routine visit is fast; only genuinely new ones cost anything.

The colour is the safety mechanism. Nothing is hidden from you, but anything
that could do damage as a public reply is visibly marked before you send it.

---

## Requirements

This extension is a client. It needs a **Review Desk** — a small service that
stores reviews, drafts replies, and tracks approval state — exposing:

| Endpoint | Purpose |
|---|---|
| `GET /api/queue?status=approved` | Replies cleared for posting |
| `POST /api/item/{id}/decision` | Mark an item `posted` |
| `POST /api/ingest` | Accept re-scraped reviews |

All requests carry an `X-Dashboard-Token` header.

Without that backend the extension loads but has nothing to offer — you'll see
a banner saying it can't reach the desk.

---

## Install

Not on the Chrome Web Store; load it unpacked.

1. **Download** — [download the ZIP](../../archive/refs/heads/main.zip) and
   unzip it, or `git clone` this repo.
2. Open **`chrome://extensions`**.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. On the extension card click **Details → Extension options**, then set:
   - **Review Desk URL** — where your desk is deployed
   - **Dashboard token** — the same value as `DASHBOARD_TOKEN` on your server
   - **Business name** — optional; only useful if one desk serves several listings
6. Open your Yelp for Business Reviews page. A banner appears bottom-right
   reporting how many approved replies matched.

On first install the options page opens by itself, so there's nothing to hunt
for.

**Not hosted on Render?** `host_permissions` in `manifest.json` allows
`*.onrender.com` and localhost. Add your own host there and reload the
extension.

---

## Zero-setup builds for a team

If you're rolling this out to staff, don't make each person paste a token.
Build a ZIP that arrives already configured:

```bash
./build-configured.sh https://your-desk.onrender.com YOUR_DASHBOARD_TOKEN
# → dist/review-desk-helper-configured.zip
```

Staff unzip it and load it unpacked — no options screen, nothing to enter. The
extension reads the bundled `config.json` on install and seeds itself, then
never touches it again (a value someone sets by hand always wins).

**That ZIP contains a live token**, which grants full read/write access to your
Review Desk. Hand it to people directly; never attach it to a public release or
commit it. `config.json` and `dist/` are gitignored for that reason.

---

## Security

- **The token never touches the Yelp page.** All API calls run in the service
  worker; the content script (which shares a context with Yelp's own scripts)
  only receives reply text. `host_permissions` also means the desk API needs no
  CORS headers.
- **Credentials live in `chrome.storage.sync`**, not in the source.
- **Nothing is posted automatically** — to Yelp or anywhere else.

---

## Maintenance

The content script reads Yelp's DOM directly: star ratings from
`aria-label="N star rating"`, reviewer blocks from a `passport-container` class.
Yelp changes these without notice.

**If buttons stop appearing**, that's almost certainly why — the selectors in
`content.js` need updating. The parsing helpers are grouped at the top of the
file for exactly this reason.

**If a review has no button at all**, it isn't in the desk's queue. Usually that
means drafting failed. The most common cause is an exhausted LLM quota on the
desk side, which the banner now reports explicitly instead of failing silently.

---

## Why it stops short of posting

Automating the Send click would mean driving `biz.yelp.com` with your session
against Yelp's Terms of Service, putting the business listing itself at risk.
An AI-drafted reply posted to a 1-star review without a human reading it is
also public and permanent.

Keeping a person on that final click is a deliberate design choice, not a
missing feature.

## License

MIT — see [LICENSE](LICENSE).
