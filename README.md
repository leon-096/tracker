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

### 3. Fill in `js/config.js`

```javascript
window.TRACKER_CONFIG = {
  GIST_ID: "your-gist-id-here",
  GIST_FILENAME: "data.enc",
  GITHUB_TOKEN: "github_pat_your_token_here",
  TIMEZONE: "Asia/Dhaka",
};
```

The token ships in the bundle. That is an accepted trade-off: someone reading
the JS can write garbage to your Gist, but cannot read your data (it is
encrypted with a password that is never stored), and cannot touch the rest of
your GitHub account (the token is Gist-scoped).

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
| `setup required` | `js/config.js` still has the placeholders. |
| `Gist not found (404)` | Wrong `GIST_ID`, or the gist was deleted. |
| `token rejected (401/403)` | Regenerate the PAT with Gists → read & write. |
| Sync dot red | Network/API failure; retries automatically (1s → 30s backoff). |
| Wrong password | `> ACCESS DENIED — wrong password.` There is no reset. |

## Files

```
index.html          app shell
css/style.css       all styles (strict dark)
js/config.js        your Gist ID + PAT
js/crypto.js        Web Crypto (PBKDF2, AES-GCM)
js/gist.js          Gist read/write + retry
js/store.js         state, debounce, persistence
js/habits.js        habit CRUD + logging
js/gamify.js        XP, levels, badges, consistency
js/ui.js            DOM helpers, dates, toasts, modals
js/graphs.js        Chart.js views
js/heatmap.js       53 × 7 grid
js/auth.js          create/login/session
js/app.js           views, routing, events
.nojekyll           serve files as-is on Pages
```
