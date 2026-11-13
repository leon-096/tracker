# tracker

A single-user habit tracker with XP, levels, badges, a consistency score, a
GitHub-style heatmap, weekly/monthly charts, and an encrypted sync blob in a
private GitHub Gist. Strict dark mode, terminal aesthetic, no backend, no build
step.

Everything runs in the browser. Data is encrypted with your password via
PBKDF2 + AES-GCM before it ever leaves the device; the Gist only ever holds
ciphertext.

---

## What you need

1. A GitHub account.
2. A **private Gist** to hold the encrypted blob.
3. A **fine-grained personal access token** with *only* the Gist permission.
4. This repo pushed to GitHub, with Pages enabled.

You do **not** need npm, Node, or a build tool.

---

## Setup

### 1. Create the private Gist

1. Go to <https://gist.github.com>.
2. Filename: `data.enc`
3. Content: `{}` (any placeholder — the app overwrites it).
4. Description: `habit-tracker-data`
5. Choose **Create secret gist**.
6. Copy the **Gist ID** from the URL:
   `https://gist.github.com/<your-username>/<GIST_ID>`

### 2. Create the token

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. Name it something like `habit-tracker`.
3. Expiration: as long as you like.
4. **Account permissions → Gists → Read and write.** Leave every other
   permission at *No access*.
5. Generate the token and copy it (`github_pat_…`). You will not see it again.

### 3. Connect the app

Open the deployed site. The setup screen asks for the Gist ID and token; they
are stored in this browser's `localStorage` and are **never committed**. The
app uses them for every Gist request. Use **Settings → Connection → Change**
to replace or clear them.

Prefer bundled credentials? Fill `js/config.js` instead:

```javascript
window.TRACKER_CONFIG = {
  GIST_ID: "your-gist-id-here",
  GIST_FILENAME: "data.enc",
  GITHUB_TOKEN: "github_pat_your_token_here",
  TIMEZONE: "Asia/Dhaka",
};
```

Bundled values take precedence. **Do not commit a token to a public repo**:
GitHub Pages serves `config.js` as a public file, and a Gists read/write token
can read and write **every gist on the account**, not only the tracker. Use a
dedicated GitHub account if you bundle credentials.

Browser storage is also readable by scripts on the same origin; all
`<user>.github.io` project sites share that origin. The strict CSP blocks
third-party scripts, but avoid saving the token in a browser profile that also
loads untrusted Pages sites.

### 4. Push and enable GitHub Pages

```bash
git init
git add .
git commit -m "habit tracker"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment**
→ Source: **Deploy from a branch**
→ Branch: **main**, folder **/ (root)** → **Save**.

Wait a minute, then open `https://<you>.github.io/<repo>/`.

The repo can be public or private (private Pages may require a paid plan). The
data stays encrypted either way. `.nojekyll` is included so Pages serves the
files as-is.

---

## First use

1. Open the site. Because the Gist has no encrypted blob yet, you get
   **"new account"**.
2. Choose a password (min 8 chars) and confirm. There is **no recovery** — if
   you forget it, the data is gone.
3. The app seeds 14 habits and writes the first encrypted blob.
4. After that, every device shows **only** the login screen. There is no
   create-account option once the blob exists.

Use the same URL + password on your phone and laptop; changes sync through the
Gist (debounced 500 ms, with retry/backoff and a header sync dot).

---

## Validate against your real Gist

After pasting your two values into `js/config.js`, work through this in order.
No need to open devtools for any of it — every result is on the lock screen.

**1. Reload and read the config checklist.**
The lock screen lists `GIST_ID`, `TOKEN`, `FILE` and `TIMEZONE` with `ok`,
`missing`, or `check format`. `missing` means the placeholder is still there;
`not a gist id` means the value is not 20 or 32 hex characters (people often
paste the username or the gist title); `unrecognised prefix` means the token
does not start with `github_pat_` or `ghp_`.

**2. Expect one of three outcomes.**

| What you see | What it means |
|---|---|
| `new account` + `no data.enc in this gist` | Read worked. The gist is reachable and has no blob yet, so creating the password is the right next step. |
| `locked` + `encrypted store found` | Read worked and `data.enc` is a valid blob. Enter the password you used on your other device. |
| `connection failed` + a code | Read failed. The code and hint list name the exact problem — see the table below. |

**3. Confirm the gist is really yours.**
Both the create and login screens print the gist's owner, description, public/
secret state, and file list. If the description is not `habit-tracker-data`, or
it says `PUBLIC`, you are pointed at the wrong gist — fix `GIST_ID` before
entering a password.

**4. Create the account, then verify the first write.**
Submit a password (min 8). The screen says `> deriving key…`, then unlocks to
Today with the 14 seed habits. The header dot turns green and `last synced`
shows a time. If the dot is red, the code is in the tooltip and on the lock
screen after a reload.

**5. Prove round-trip persistence.**
Log one habit, wait ~2 seconds for the debounced write, then reload. You should
land on `locked`, enter the password, and see the habit still checked. That is
the same path a second device takes.

**6. Prove a wrong password is rejected.**
Reload, enter a wrong password: `> ACCESS DENIED — wrong password. the blob did
not authenticate.` Nothing is written; the gist is untouched.

**7. Prove the token's limits.**
Optional but useful: in the token settings set Gists to *read only*, reload, log
a habit. The dot goes red with `[ERR_TOKEN_SCOPE_403]` and the write is refused
— the read side still works. Set it back to read & write afterwards.

### Lock-screen error codes

| Code | Cause | Fix |
|---|---|---|
| `ERR_CONFIG` | No usable credentials | Enter them on the setup screen, or fill `js/config.js` and reload |
| `ERR_TOKEN_401` | Token wrong, expired, revoked, or mistyped | Regenerate the PAT, paste the whole string |
| `ERR_TOKEN_SCOPE_403` | Token valid but no Gists permission | Account permissions → Gists → Read and write |
| `ERR_RATE_LIMIT_403` | 5,000 requests/hour used | Wait for the reset time shown |
| `ERR_FORBIDDEN_403` | Other 403 (SSO, policy) | Read the GitHub message in the details block |
| `ERR_GIST_404` | Wrong `GIST_ID`, deleted gist, or token can't see it | Copy the id from the gist URL; check Gists permission |
| `ERR_NETWORK` | `api.github.com` unreachable | Connection, VPN, or an extension blocking it |
| `ERR_GITHUB_5XX` | GitHub outage | Retry; check status.github.com |
| `ERR_HTTP_BODY` | Response was not JSON | Proxy/captive portal intercepting api.github.com |
| `ERR_HTTP_422` | GitHub rejected the request body | Keep `GIST_FILENAME` as `data.enc` |
| `ERR_HTTP_<code>` | Any unmapped status | Read the GitHub message in the details block |
| `ERR_GIST_TRUNCATED` | Blob over ~1 MB in the API response | Download the file from the gist and keep it as a backup |
| `ERR_BLOB_JSON` | `data.enc` is not JSON | Something else wrote to the file; restore a backup |
| `ERR_BLOB_SHAPE` | Missing `salt`/`iv`/`ciphertext` | Restore the original blob; do not hand-edit it |
| `ERR_BLOB_SIZES` | Base64 salt/iv/ciphertext of wrong length | Restore an untouched copy of the blob |

Every failure screen has **Retry** and **Copy diagnostics** (code, HTTP status,
GitHub's message, masked gist id, masked token, filename, origin, user agent —
no secrets) so a problem can be reported without exposing the key.

---

## Everyday use

- **Today** — date selector (past days editable, future locked), completion
  ring, habit controls. Tapping a boolean shows `> +10 XP`.
- **Graphs** — weekly/monthly, prev/next period, per-habit filter, stats.
- **Heatmap** — 53 × 7 grid for the last year; click a cell to open that day.
- **Trophies** — 14 cumulative badges; locked ones are dimmed with their
  condition. Nothing is ever revoked, and no-porn milestones count clean days
  rather than consecutive streaks.
- **Manage** — add, edit, delete, reorder (arrows or drag).
- **Settings** — app title, CRT scanlines, export/import JSON, reset
  (double-confirmed), masked credentials, and the helpline reminder.

### XP

- boolean → 10 XP, value → 10 XP, count → 5 XP per unit (max 50 per habit/day)
- hard cap of **120 XP per day**; extra logging still saves, just without XP
- level = `floor(total / 1000) + 1`, with a progress bar in the header

---

## Security notes

- Password is never stored (not plain, not hashed). Only a derived key is kept
  in `sessionStorage` so a soft reload in the same tab doesn't ask again.
- PBKDF2-SHA-256, 250,000 iterations, 16-byte random salt, AES-GCM with a
  random 12-byte IV per save.
- Clearing site data logs you out; your data is still in the Gist.
- **Logout** drops the session key and reloads to the lock screen.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup required` | No browser credentials and `js/config.js` still has placeholders. |
| `Gist not found (404)` | Wrong `GIST_ID`, or the gist was deleted. |
| `token rejected (401/403)` | Regenerate the PAT with Gists → read & write. |
| Sync dot red | Network/API failure; retries automatically (1s → 30s backoff). |
| Wrong password | `> ACCESS DENIED — wrong password.` There is no reset. |

## Files

```
index.html          app shell
css/style.css       all styles (strict dark)
js/config.js        optional bundled Gist ID + PAT
js/crypto.js        Web Crypto (PBKDF2, AES-GCM)
js/gist.js          Gist read/write + retry
js/store.js         state, debounce, persistence
js/habits.js        habit CRUD + logging
js/gamify.js        XP, levels, badges, consistency
js/ui.js            DOM helpers, dates, toasts, modals
js/graphs.js        Chart.js views
js/vendor/chart.umd.js  Chart.js 4.4.1, self-hosted (MIT)
js/heatmap.js       53 × 7 grid
js/auth.js          create/login/session
js/app.js           views, routing, events
.nojekyll           serve files as-is on Pages
```
