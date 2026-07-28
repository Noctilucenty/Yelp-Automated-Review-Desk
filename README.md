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

## Download

### ➜ [Download the latest release](../../releases/latest)

Grab the `.zip` under **Assets** and unzip it. You'll get a folder called
`review-desk-helper` with a `manifest.json` inside — that folder is the
extension.

On macOS Safari and Chrome unzip downloads automatically, so check your
Downloads folder before unzipping again.

**Why the release and not the green Code button?** A release is a fixed,
numbered version. `main` moves, so a copy taken from it has no version you can
compare against later — and because Chrome cannot auto-update an extension
loaded this way (see [Updating](#updating)), knowing which version you have is
the only way to tell whether you are missing a fix.

<details>
<summary>Other ways to get it</summary>

- `git clone https://github.com/Noctilucenty/Yelp-Automated-Review-Desk.git` —
  best if you intend to change the code; `git pull` then replaces the download
  step when updating.
- [Download `main` as a ZIP](../../archive/refs/heads/main.zip) — the newest
  code, including anything not yet released. Unversioned; use a release unless
  you specifically want unreleased changes.

</details>

---

## Install

Not on the Chrome Web Store, so Chrome loads it straight from the folder.

1. **Download and unzip** it (above). Keep the folder somewhere permanent —
   Chrome reads it from that location every time it starts, so a folder in
   Downloads that you later clear out will break the extension.
2. Open **`chrome://extensions`**.
3. Turn on **Developer mode** — top-right corner.
4. Click **Load unpacked** and select the unzipped folder — the one with
   `manifest.json` directly inside it. If Chrome says it cannot find a manifest,
   you have selected the wrapper folder; go one level in.
5. The options page opens by itself. Fill in:
   - **Review Desk URL** — where your desk is deployed
   - **Dashboard token** — the same value as `DASHBOARD_TOKEN` on your server
   - **Business name** — optional; only useful if one desk serves several listings
6. Open your Yelp for Business Reviews page. A status pill appears bottom-right
   saying how many replies it matched. Give it a few seconds — it pages through
   your whole review history first.

Nothing is posted at any point. The extension fills the reply box; you press
Send.

**Not hosted on Render?** `host_permissions` in `manifest.json` allows
`*.onrender.com` and localhost. Add your own host there and reload the
extension.

### If something looks wrong

| What you see | What it means |
|---|---|
| No status pill at all | The extension is disabled, or you are not on a `biz.yelp.com/r2r/...` page |
| `Desk API 401` | Wrong dashboard token — or the desk's token was rotated and yours is stale |
| `could not reach the desk` | Wrong URL, or the desk is asleep/down |
| `nothing on screen matches the queue` | Connected fine, but the desk holds no drafts for these reviews yet |
| No buttons on a brand-new review | It was ingested on this visit; the buttons appear once drafting finishes |

---

## Updating

**Chrome does not auto-update an extension loaded unpacked.** That is not a
setting you can turn on — auto-update belongs to the Web Store, and this
extension deliberately isn't there, because a pre-configured build carries a
token that has no business on a public listing. So a copy you loaded once keeps
running that code until you replace it by hand.

That matters more than it sounds. The failures this extension has had were all
silent: a version that only ever read the first page of reviews reported
"nothing new" instead of "I only looked at page one". A fixed bug looks
identical to no bug at all, so nothing prompts you to update.

To update:

1. Download the [latest release](../../releases/latest) and unzip it.
2. Replace the contents of the folder you loaded — same folder, new files.
3. Open **`chrome://extensions`** and click the **reload** (↻) icon on the card.

Your settings survive: the desk URL and token live in Chrome's storage, not in
the folder, so there is nothing to paste again.

The extension checks the releases page once a day and appends a line to its
status pill when a newer version exists. That check is best-effort — offline,
rate-limited, or blocked all mean it stays quiet rather than showing an error.
If you would rather it never called GitHub, remove `https://api.github.com/*`
from `host_permissions`; everything else keeps working.

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
