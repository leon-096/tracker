/* gist.js — read/write the encrypted blob in a private Gist.
   Read:  GET   /gists/:id
   Write: PATCH /gists/:id   (debounced by store.js, retried here)

   Every failure is raised as a GistError with:
     kind      machine category (config | auth | scope | rate | notfound |
               network | server | malformed | truncated | http)
     code      short code shown on the lock screen (ERR_GIST_404, …)
     message   one-line, human-readable
     hints     concrete next steps, including which config key to check
     detail    optional extra context (e.g. which fields were missing)
     httpStatus / githubMessage  raw response info for debugging             */
window.GistAPI = (function () {
  "use strict";

  const cfg = window.TRACKER_CONFIG || {};
  const API = "https://api.github.com";
  const statusHandlers = new Set();
  let current = { status: "idle", message: "", code: "", retryable: true, at: null };
  let lastOkAt = null;

  function filename() {
    return cfg.GIST_FILENAME || "data.enc";
  }

  function gistId() {
    return String(cfg.GIST_ID || "").trim();
  }

  function token() {
    return String(cfg.GITHUB_TOKEN || "").trim();
  }

  function isConfigured() {
    const id = gistId();
    const tok = token();
    if (!id || !tok) return false;
    if (id.indexOf("PASTE") !== -1 || tok.indexOf("PASTE") !== -1) return false;
    return true;
  }

  function gistError(kind, code, message, extra) {
    const err = new Error(message);
    err.name = "GistError";
    err.kind = kind;
    err.code = code;
    if (extra) Object.assign(err, extra);
    return err;
  }

  function headers(extra) {
    return Object.assign(
      {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token(),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      extra || {}
    );
  }

  function maskToken(value) {
    const t = String(value || "");
    if (!t) return "—";
    if (t.length <= 8) return "••••";
    return t.slice(0, 4) + "••••••••" + t.slice(-4);
  }

  function maskId(id) {
    const s = String(id || "");
    if (!s) return "—";
    if (s.length <= 10) return s;
    return s.slice(0, 6) + "…" + s.slice(-4);
  }

  function timezoneValid() {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: cfg.TIMEZONE || "Asia/Dhaka" }).format(new Date());
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------ diagnostics */

  function configReport() {
    const id = gistId();
    const tok = token();
    const idPlaceholder = !id || id.indexOf("PASTE") !== -1;
    const tokenPlaceholder = !tok || tok.indexOf("PASTE") !== -1;
    const tokenPrefix = /^github_pat_/.test(tok) ? "fine-grained" : /^ghp_/.test(tok) ? "classic" : "unknown";

    return {
      configured: !idPlaceholder && !tokenPlaceholder,
      gistId: {
        present: !!id,
        placeholder: idPlaceholder,
        masked: idPlaceholder ? "—" : maskId(id),
        looksValid: /^[0-9a-f]{20}$|^[0-9a-f]{32}$/i.test(id),
        length: id.length,
      },
      token: {
        present: !!tok,
        placeholder: tokenPlaceholder,
        masked: tokenPlaceholder ? "—" : maskToken(tok),
        prefix: tokenPrefix,
        looksValid: tokenPrefix !== "unknown",
      },
      filename: filename(),
      timezone: cfg.TIMEZONE || "Asia/Dhaka",
      timezoneValid: timezoneValid(),
    };
  }

  function configError() {
    return gistError("config", "ERR_CONFIG", "js/config.js is not filled in yet.", {
      hints: [
        "Set GIST_ID to the id in the gist URL: gist.github.com/<user>/<id>.",
        "Set GITHUB_TOKEN to a fine-grained PAT with Account permissions → Gists → Read and write.",
        "Save the file and reload the page (a hard reload avoids a cached copy).",
      ],
    });
  }

  /* ------------------------------------------------------------- error maps */

  function httpError(status, githubMessage, remaining, resetEpoch) {
    const details = { httpStatus: status, githubMessage: githubMessage || "" };
    const resetTime = resetEpoch ? new Date(Number(resetEpoch) * 1000) : null;

    if (status === 401) {
      return gistError("auth", "ERR_TOKEN_401", "GitHub rejected the token (401 Unauthorized).", Object.assign({
        hints: [
          "GITHUB_TOKEN is wrong, expired, revoked, or was pasted with a character missing.",
          "Regenerate it at github.com/settings/personal-access-tokens and paste the whole github_pat_… string.",
          "Classic tokens (ghp_…) work too, but need the gist scope.",
        ],
      }, details));
    }

    if (status === 403) {
      if (remaining === "0") {
        return gistError("rate", "ERR_RATE_LIMIT_403", "GitHub rate limit reached (403).", Object.assign({
          hints: [
            "The token is valid but has used its 5,000 requests/hour.",
            resetTime
              ? "Resets at " + resetTime.toISOString().replace("T", " ").slice(0, 19) + " UTC."
              : "Wait up to an hour, then retry.",
            "This app writes at most a few times a minute, so a hit usually means another tool shares the token.",
          ],
        }, details));
      }
      if (/resource not accessible/i.test(githubMessage || "")) {
        return gistError("scope", "ERR_TOKEN_SCOPE_403", "The token is valid but cannot access Gists.", Object.assign({
          hints: [
            "Open the token's settings and set Account permissions → Gists → Read and write.",
            "Nothing else is needed; leave all other permissions at No access.",
            "Save the token, then reload this page.",
          ],
        }, details));
      }
      return gistError("forbidden", "ERR_FORBIDDEN_403", "GitHub refused the request (403).", Object.assign({
        hints: [
          "Check the token's Gists permission is Read and write.",
          "If your organisation enforces SAML SSO, authorise the token for that organisation.",
          githubMessage ? "GitHub said: " + githubMessage : "GitHub returned no further detail.",
        ],
      }, details));
    }

    if (status === 404) {
      return gistError("notfound", "ERR_GIST_404", "No accessible gist at this GIST_ID (404).", Object.assign({
        hints: [
          "GIST_ID must be the 20- or 32-character id from gist.github.com/<user>/<id> — not the username and not the gist title.",
          "If the gist was deleted or recreated, copy its new id into js/config.js.",
          "If the id is correct, the token cannot see this gist: give it Account permissions → Gists → Read and write.",
        ],
      }, details));
    }

    if (status === 422) {
      return gistError("http", "ERR_HTTP_422", "GitHub rejected the request body (422).", Object.assign({
        hints: [
          "This usually means GIST_FILENAME contains an invalid file name.",
          "Leave GIST_FILENAME as \"data.enc\" unless you renamed the file in the gist.",
        ],
      }, details));
    }

    if (status >= 500) {
      return gistError("server", "ERR_GITHUB_5XX", "GitHub is having trouble (HTTP " + status + ").", Object.assign({
        hints: [
          "This is on GitHub's side — retry in a minute.",
          "status.github.com lists incidents.",
        ],
      }, details));
    }

    return gistError("http", "ERR_HTTP_" + status, "GitHub returned HTTP " + status + ".", Object.assign({
      hints: [githubMessage || "GitHub returned no message; retry in a moment."],
    }, details));
  }

  function networkError(err) {
    return gistError("network", "ERR_NETWORK", "Could not reach api.github.com.", {
      hints: [
        "The browser reported: " + (err && err.message ? err.message : "network error") + ".",
        "Check the connection, VPN, or an ad-blocker/privacy extension blocking api.github.com.",
        "This app calls GitHub directly — there is no proxy in between.",
      ],
    });
  }

  /* ---------------------------------------------------------------- status */

  function setStatus(status, message, code, retryable) {
    current = {
      status,
      message: message || "",
      code: code || "",
      retryable: retryable !== false,
      at: Date.now(),
    };
    if (status === "ok") lastOkAt = new Date();
    statusHandlers.forEach((fn) => {
      try { fn(getStatus()); } catch (e) { /* listener errors are not fatal */ }
    });
  }

  function onStatus(fn) {
    statusHandlers.add(fn);
    return function () { statusHandlers.delete(fn); };
  }

  function getStatus() {
    return {
      status: current.status,
      message: current.message,
      code: current.code,
      retryable: current.retryable,
      at: current.at,
      lastOkAt,
    };
  }

  /* ------------------------------------------------------------------ read */

  async function read() {
    if (!isConfigured()) throw configError();

    const id = gistId();
    const url = API + "/gists/" + encodeURIComponent(id) + "?_=" + Date.now();
    let res;

    try {
      res = await fetch(url, { method: "GET", headers: headers(), cache: "no-store" });
    } catch (err) {
      throw networkError(err);
    }

    if (!res.ok) {
      let githubMessage = "";
      try {
        const body = await res.json();
        githubMessage = body && body.message ? body.message : "";
      } catch (e) { /* body may not be JSON */ }
      throw httpError(
        res.status,
        githubMessage,
        res.headers.get("x-ratelimit-remaining"),
        res.headers.get("x-ratelimit-reset")
      );
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw gistError("malformed", "ERR_HTTP_BODY", "GitHub's response was not JSON.", {
        hints: [
          "A proxy, captive portal, or extension may be intercepting api.github.com.",
          "Retry on another network or without extensions.",
        ],
        httpStatus: res.status,
      });
    }

    const files = json && json.files && typeof json.files === "object" ? json.files : {};
    const gist = {
      id: json.id || id,
      description: json.description || "",
      owner: json.owner && json.owner.login ? json.owner.login : "",
      fileNames: Object.keys(files),
      isPublic: !!json.public,
    };

    const file = files[filename()];
    if (!file) {
      return { exists: false, blob: null, gist, reason: "missing-file" };
    }

    if (file.truncated || (file.size && !file.content)) {
      throw gistError("truncated", "ERR_GIST_TRUNCATED", filename() + " is too large to read through the Gist API.", {
        hints: [
          "GitHub truncates file content in API responses above ~1 MB, so the blob cannot be decrypted here.",
          "Open the gist and download " + filename() + " as a backup before changing anything.",
          "This tracker's dataset normally stays far below 1 MB.",
        ],
        gist,
      });
    }

    const raw = String(file.content || "").trim();
    if (!raw) {
      return { exists: false, blob: null, gist, reason: "empty-file" };
    }

    let blob;
    try {
      blob = JSON.parse(raw);
    } catch (e) {
      throw gistError("malformed", "ERR_BLOB_JSON", filename() + " is not valid JSON.", {
        hints: [
          "Expected an encrypted blob: {\"salt\":\"…\",\"iv\":\"…\",\"ciphertext\":\"…\"}.",
          "Something else wrote to this file — check other tools sharing the token.",
          "Restore a backup of " + filename() + " in the gist, then reload.",
        ],
        detail: "starts with: " + JSON.stringify(raw.slice(0, 40)),
        gist,
      });
    }

    if (!blob || typeof blob !== "object" || Array.isArray(blob)) {
      throw gistError("malformed", "ERR_BLOB_SHAPE", filename() + " does not contain an object.", {
        hints: [
          "Expected { salt, iv, ciphertext } as base64 strings.",
          "Found: " + (Array.isArray(blob) ? "an array" : typeof blob) + ".",
        ],
        gist,
      });
    }

    const keys = Object.keys(blob);
    const missing = ["salt", "iv", "ciphertext"].filter((k) => typeof blob[k] !== "string" || !blob[k]);

    if (missing.length === 3 && keys.length === 0) {
      return { exists: false, blob: null, gist, reason: "empty-object" };
    }

    if (missing.length) {
      throw gistError("malformed", "ERR_BLOB_SHAPE", filename() + " is missing encryption fields.", {
        hints: [
          "Expected keys: salt, iv, ciphertext (all base64 strings).",
          "Found: " + (keys.length ? keys.join(", ") : "nothing") + ". Missing: " + missing.join(", ") + ".",
          "If this file was edited or restored by hand, put back the original blob.",
        ],
        gist,
      });
    }

    const lengths = { salt: -1, iv: -1, ciphertext: -1 };
    for (const key of ["salt", "iv", "ciphertext"]) {
      try {
        lengths[key] = CryptoUtil.base64ToBytes(blob[key]).length;
      } catch (e) {
        lengths[key] = -1;
      }
    }

    if (lengths.salt !== 16 || lengths.iv !== 12 || lengths.ciphertext < 16) {
      throw gistError("malformed", "ERR_BLOB_SIZES", filename() + " has malformed encryption fields.", {
        hints: [
          "salt must decode to 16 bytes (got " + lengths.salt + ").",
          "iv must decode to 12 bytes (got " + lengths.iv + ").",
          "ciphertext must decode to at least 16 bytes (got " + lengths.ciphertext + ").",
          "All three must be base64. Restore an untouched copy of the blob.",
        ],
        gist,
      });
    }

    return { exists: true, blob, gist, reason: "ok" };
  }

  /* ----------------------------------------------------------------- write */

  function retryableStatus(status) {
    return status === 429 || status >= 500;
  }

  async function write(blob) {
    if (!isConfigured()) {
      const err = configError();
      setStatus("error", err.message, err.code, false);
      return { ok: false, error: err };
    }

    const content = JSON.stringify(blob);
    const maxAttempts = 6;
    let last = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setStatus("syncing", "", "", true);
      let res = null;

      try {
        res = await fetch(API + "/gists/" + encodeURIComponent(gistId()), {
          method: "PATCH",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ files: { [filename()]: { content } } }),
          cache: "no-store",
        });
      } catch (err) {
        last = networkError(err);
        last.retryable = true;
        setStatus("error", last.message, last.code, true);
      }

      if (res) {
        if (res.ok) {
          setStatus("ok", "", "", false);
          return { ok: true };
        }

        let githubMessage = "";
        try {
          const body = await res.json();
          githubMessage = body && body.message ? body.message : "";
        } catch (e) { /* not JSON */ }

        last = httpError(
          res.status,
          githubMessage,
          res.headers.get("x-ratelimit-remaining"),
          res.headers.get("x-ratelimit-reset")
        );
        const retry = retryableStatus(res.status);
        last.retryable = retry;
        setStatus("error", last.message, last.code, retry);
        if (!retry) return { ok: false, error: last };
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return { ok: false, error: last };
  }

  return {
    isConfigured,
    configReport,
    read,
    write,
    onStatus,
    getStatus,
    maskToken,
    maskId,
    config: cfg,
  };
})();
