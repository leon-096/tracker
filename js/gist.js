/* gist.js — read/write the encrypted blob in a private Gist.
   Read:  GET   /gists/:id
   Write: PATCH /gists/:id   (debounced by store.js, retried here)           */
window.GistAPI = (function () {
  "use strict";

  const cfg = window.TRACKER_CONFIG || {};
  const API = "https://api.github.com";
  const statusHandlers = new Set();
  let current = { status: "idle", message: "", at: null };
  let lastOkAt = null;

  function filename() {
    return cfg.GIST_FILENAME || "data.enc";
  }

  function isConfigured() {
    const id = String(cfg.GIST_ID || "").trim();
    const token = String(cfg.GITHUB_TOKEN || "").trim();
    if (!id || !token) return false;
    if (id.indexOf("PASTE") !== -1 || token.indexOf("PASTE") !== -1) return false;
    return true;
  }

  function headers(extra) {
    return Object.assign(
      {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + String(cfg.GITHUB_TOKEN).trim(),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      extra || {}
    );
  }

  function setStatus(status, message) {
    current = { status, message: message || "", at: Date.now() };
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
      at: current.at,
      lastOkAt,
    };
  }

  async function read() {
    const url = API + "/gists/" + encodeURIComponent(cfg.GIST_ID) + "?_=" + Date.now();
    const res = await fetch(url, {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });

    if (res.status === 404) {
      throw new Error("Gist not found (404) — check GIST_ID in js/config.js.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub rejected the token (" + res.status + ") — check GITHUB_TOKEN.");
    }
    if (!res.ok) {
      throw new Error("GitHub read failed: HTTP " + res.status);
    }

    const json = await res.json();
    const file = json.files ? json.files[filename()] : null;

    if (!file || !file.content) {
      return { exists: false, blob: null, gist: json };
    }

    let blob;
    try {
      blob = JSON.parse(file.content);
    } catch (e) {
      throw new Error(filename() + " in the gist is not valid JSON.");
    }

    if (!blob || !blob.salt || !blob.iv || !blob.ciphertext) {
      return { exists: false, blob: null, gist: json };
    }

    return { exists: true, blob, gist: json };
  }

  async function write(blob) {
    const content = JSON.stringify(blob);
    const maxAttempts = 6;
    let attempt = 0;

    for (;;) {
      attempt++;
      setStatus("syncing", "");
      try {
        const res = await fetch(API + "/gists/" + encodeURIComponent(cfg.GIST_ID), {
          method: "PATCH",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ files: { [filename()]: { content } } }),
          cache: "no-store",
        });

        if (!res.ok) {
          let detail = "HTTP " + res.status;
          if (res.status === 401 || res.status === 403) detail += " — token rejected";
          if (res.status === 404) detail += " — gist not found";
          if (res.status === 429) detail += " — rate limited";
          throw new Error(detail);
        }

        setStatus("ok", "");
        return true;
      } catch (err) {
        const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
        setStatus("error", err && err.message ? err.message : "network error");
        if (attempt >= maxAttempts) return false;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  function maskToken(token) {
    const t = String(token || "");
    if (t.length <= 8) return "••••";
    return t.slice(0, 4) + "••••••••" + t.slice(-4);
  }

  function maskId(id) {
    const s = String(id || "");
    if (s.length <= 10) return s;
    return s.slice(0, 6) + "…" + s.slice(-4);
  }

  return {
    isConfigured,
    read,
    write,
    onStatus,
    getStatus,
    maskToken,
    maskId,
    config: cfg,
  };
})();
