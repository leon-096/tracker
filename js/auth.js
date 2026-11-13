/* auth.js — create-password / login flows, the session key cache, and the
   lock-screen diagnostics (config checklist + precise Gist failures).
   The password is never stored; only a derived key may live in sessionStorage
   for a soft reload within the same tab.                                    */
window.Auth = (function () {
  "use strict";

  const SESSION_KEY = "tracker.session.v1";
  let busy = false;

  function lockBody() {
    return document.getElementById("lock-body");
  }

  function setLock(nodes) {
    const body = lockBody();
    if (!body) return;
    UI.clear(body);
    for (const node of nodes) if (node) body.appendChild(node);
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.key || !data.salt) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeSession(keyB64, salt) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ key: keyB64, salt }));
    } catch (e) {
      /* private mode may refuse; login still works for the tab */
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function hideLock() {
    document.getElementById("lock-screen").hidden = true;
    document.getElementById("app").hidden = false;
  }

  /* ----------------------------------------------------------- diagnostics */

  function checkRow(label, value, flag, flagClass) {
    return UI.el("div", { class: "check-row" }, [
      UI.el("span", { class: "check-k", text: label }),
      UI.el("span", { class: "check-v", text: value || "—" }),
      UI.el("span", { class: "check-flag " + flagClass, text: flag }),
    ]);
  }

  function configRows() {
    const report = GistAPI.configReport();
    const section = UI.el("div", { class: "lock-section" }, [
      UI.el("div", { class: "check-title", text: "// credentials" }),
    ]);
    const list = UI.el("div", { class: "check-list" });

    let idFlag = "ok";
    let idClass = "ok";
    if (report.gistId.placeholder) { idFlag = "missing"; idClass = "bad"; }
    else if (!report.gistId.looksValid) { idFlag = report.gistId.length + " chars — not a gist id"; idClass = "warn"; }

    let tokenFlag = "ok";
    let tokenClass = "ok";
    if (report.token.placeholder) { tokenFlag = "missing"; tokenClass = "bad"; }
    else if (!report.token.looksValid) { tokenFlag = "unrecognised prefix"; tokenClass = "warn"; }
    else tokenFlag = report.token.prefix;

    const sourceLabel = report.source === "browser" ? "this browser" : report.source === "config" ? "js/config.js" : "—";
    list.appendChild(checkRow("GIST_ID", report.gistId.masked, idFlag, idClass));
    list.appendChild(checkRow("TOKEN", report.token.masked, tokenFlag, tokenClass));
    list.appendChild(checkRow("SOURCE", sourceLabel, report.source === "none" ? "missing" : "ok", report.source === "none" ? "bad" : "ok"));
    list.appendChild(checkRow("FILE", report.filename, "ok", "ok"));
    list.appendChild(
      checkRow("TIMEZONE", report.timezone, report.timezoneValid ? "ok" : "invalid", report.timezoneValid ? "ok" : "bad")
    );

    section.appendChild(list);
    return section;
  }

  function problemBlock(err) {
    const box = UI.el("div", { class: "problem" });

    box.appendChild(UI.el("div", { class: "problem-code", text: "[" + (err.code || "ERR_UNKNOWN") + "]" }));
    box.appendChild(UI.el("p", { class: "problem-msg", text: err.message || "Unknown error." }));

    if (err.detail) {
      box.appendChild(UI.el("p", { class: "small dim", text: err.detail }));
    }

    if (err.hints && err.hints.length) {
      const ul = UI.el("ul", { class: "hint-list" });
      err.hints.forEach((hint) => ul.appendChild(UI.el("li", { text: hint })));
      box.appendChild(ul);
    }

    const kv = UI.el("div", { class: "kv" });
    const add = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      kv.appendChild(UI.el("span", { class: "kv-k", text: k }));
      kv.appendChild(UI.el("span", { class: "kv-v", text: String(v) }));
    };

    const info = GistAPI.credentialInfo();
    add("status", err.httpStatus ? "HTTP " + err.httpStatus : err.kind || "");
    add("github", err.githubMessage || "");
    add("request", "GET api.github.com/gists/" + info.maskedId);
    add("token", info.maskedToken);
    add("file", info.filename);
    if (err.gist && err.gist.description) add("gist", '"' + err.gist.description + '"');
    if (err.gist && err.gist.owner) add("owner", "@" + err.gist.owner);
    if (kv.childNodes.length) box.appendChild(kv);

    return box;
  }

  function gistLine(gist) {
    const bits = ["gist " + GistAPI.maskId(gist.id || "")];
    if (gist.owner) bits.push("@" + gist.owner);
    if (gist.description) bits.push('"' + gist.description + '"');
    bits.push(gist.isPublic ? "PUBLIC" : "private");

    const line = UI.el("div", { class: "lock-meta" }, [
      UI.el("div", { text: "> " + bits.join(" · ") }),
      UI.el("div", {
        text: "files: " + (gist.fileNames.length
          ? gist.fileNames.slice(0, 4).join(", ") + (gist.fileNames.length > 4 ? "…" : "")
          : "none"),
      }),
    ]);

    if (gist.isPublic) {
      line.appendChild(
        UI.el("div", {
          class: "check-flag warn",
          text: "! this gist is public — data is still encrypted, but make it secret",
        })
      );
    }
    return line;
  }

  function copyDiagnostics(err) {
    const report = GistAPI.configReport();
    const lines = [
      "habit-tracker diagnostics",
      "time: " + new Date().toISOString(),
      "code: " + (err.code || "ERR_UNKNOWN"),
      "message: " + (err.message || ""),
      "kind: " + (err.kind || ""),
      "http: " + (err.httpStatus || "—"),
      "github: " + (err.githubMessage || "—"),
      "gist: " + report.gistId.masked + " (" + report.gistId.length + " chars)",
      "token: " + report.token.masked + " (" + report.token.prefix + ")",
      "credentials: " + report.source,
      "file: " + report.filename,
      "timezone: " + report.timezone,
      "origin: " + location.origin,
      "ua: " + navigator.userAgent,
    ];
    const text = lines.join("\n");
    const done = () => UI.toast("> diagnostics copied", "info", 1600);
    const fail = () => UI.toast("> could not copy — select the text manually", "error", 2200);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
      return;
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    } catch (e) {
      fail();
    }
  }

  /* ---------------------------------------------------------------- screens */

  function renderLoading() {
    setLock([
      UI.el("p", { class: "lead", text: "> opening encrypted store…" }),
      UI.el("div", { class: "loading" }, [UI.el("span", { text: "> contacting github" })]),
    ]);
  }

  function changeCredentials() {
    GistAPI.clearSavedCredentials();
    clearSession();
    init();
  }

  function credentialsButton(block) {
    if (GistAPI.credentialInfo().source !== "browser") return null;
    return UI.el("button", {
      class: "btn btn-ghost" + (block ? " btn-block" : ""),
      type: "button",
      text: block ? "use different credentials" : "Credentials",
      onclick: changeCredentials,
    });
  }

  function renderSetup() {
    const report = GistAPI.configReport();
    const gist = UI.el("input", {
      class: "input", type: "text", placeholder: "20- or 32-character gist id",
      autocomplete: "off", spellcheck: "false", "aria-label": "Gist ID",
    });
    const token = UI.el("input", {
      class: "input", type: "password", placeholder: "github_pat_… or ghp_…",
      autocomplete: "off", spellcheck: "false", "aria-label": "GitHub token",
    });
    const error = UI.el("p", { class: "form-error" });
    const submit = UI.el("button", {
      class: "btn btn-primary btn-block", type: "submit", text: "save & connect",
    });

    const form = UI.el("form", { novalidate: true }, [
      UI.el("h2", { text: "connect your gist" }),
      UI.el("p", { class: "lead", text: "> enter a private gist and a gist-scoped token. they stay in this browser." }),
      UI.el("div", { class: "field" }, [
        UI.el("label", { text: "gist id" }), gist,
      ]),
      UI.el("div", { class: "field" }, [
        UI.el("label", { text: "token" }), token,
      ]),
      error,
      UI.el("div", { style: "margin-top:14px" }, [submit]),
      UI.el("p", { class: "small dim", style: "margin-top:12px", text: "> stored only in this browser — never committed. the token needs gists read + write." }),
      (!report.gistId.placeholder || !report.token.placeholder)
        ? UI.el("p", { class: "small dim", text: "> js/config.js values are incomplete; this browser's credentials will be used." })
        : null,
      UI.el("p", { class: "small dim", text: "> prefer the file? fill js/config.js and reload." }),
    ]);

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      error.textContent = "";
      const id = gist.value.trim();
      const tok = token.value.trim();
      const problem = GistAPI.credentialProblem(id, tok);
      if (problem) {
        error.textContent = "> " + problem;
        return;
      }
      if (!GistAPI.saveCredentials(id, tok)) {
        error.textContent = "> this browser refused to store credentials. enable site storage and retry.";
        return;
      }
      init();
    });

    setLock([form]);
    gist.focus();
  }

  function renderError(err) {
    setLock([
      UI.el("h2", { text: "connection failed" }),
      problemBlock(err),
      configRows(),
      UI.el("div", { class: "row-gap", style: "margin-top:16px" }, [
        UI.el("button", {
          class: "btn btn-primary", type: "button", text: "Retry",
          onclick: () => init(),
        }),
        credentialsButton(false),
        UI.el("button", {
          class: "btn btn-ghost", type: "button", text: "Copy diagnostics",
          onclick: () => copyDiagnostics(err),
        }),
      ]),
      UI.el("p", { class: "small dim", style: "margin-top:12px", text: "> nothing was written. your data in the gist is untouched." }),
    ]);
  }

  async function init() {
    document.getElementById("lock-screen").hidden = false;
    document.getElementById("app").hidden = true;

    if (!GistAPI.isConfigured()) {
      renderSetup();
      return;
    }

    renderLoading();

    let res;
    try {
      res = await GistAPI.read();
    } catch (err) {
      renderError(err);
      return;
    }

    if (!res.exists) {
      renderCreate(res);
      return;
    }

    const session = readSession();
    if (session && session.salt === res.blob.salt) {
      try {
        const key = await CryptoUtil.importKey(session.key);
        const data = await CryptoUtil.decryptJSON(res.blob, key);
        unlock(key, res.blob.salt, data, res.revision);
        return;
      } catch (e) {
        clearSession();
      }
    }

    renderLogin(res);
  }

  function busyButton(button, label) {
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = label;
  }

  function idleButton(button) {
    button.disabled = false;
    if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }

  function inlineProblem(err) {
    const box = UI.el("div", { class: "problem", style: "margin-top:12px" }, [
      UI.el("div", { class: "problem-code", text: "[" + (err.code || "ERR_UNKNOWN") + "]" }),
      UI.el("p", { class: "problem-msg", text: err.message || "Unknown error." }),
    ]);
    if (err.hints && err.hints.length) {
      const ul = UI.el("ul", { class: "hint-list" });
      err.hints.slice(0, 3).forEach((hint) => ul.appendChild(UI.el("li", { text: hint })));
      box.appendChild(ul);
    }
    return box;
  }

  function renderCreate(res) {
    const pw = UI.el("input", {
      class: "input", type: "password", placeholder: "min 8 characters",
      autocomplete: "new-password", "aria-label": "New password",
    });
    const pw2 = UI.el("input", {
      class: "input", type: "password", placeholder: "repeat password",
      autocomplete: "new-password", "aria-label": "Repeat password",
    });
    const fill = UI.el("div", { class: "strength-fill" });
    const strengthText = UI.el("div", { class: "strength-label", text: "strength: —" });
    const error = UI.el("p", { class: "form-error" });
    const problemSlot = UI.el("div");
    const submit = UI.el("button", {
      class: "btn btn-primary btn-block", type: "submit", text: "Create password",
    });

    pw.addEventListener("input", () => {
      const s = CryptoUtil.passwordStrength(pw.value);
      fill.style.width = s.score + "%";
      fill.style.background = s.score >= 55 ? "var(--green)" : s.score >= 30 ? "var(--amber)" : "var(--err)";
      strengthText.textContent = "strength: " + (pw.value ? s.label : "—");
    });

    const notes = [];
    if (res && res.gist) {
      notes.push(gistLine(res.gist));
      if (res.reason === "empty-file" || res.reason === "empty-object") {
        notes.push(UI.el("p", { class: "small dim", text: "> data.enc exists but is empty — creating the account overwrites it." }));
      } else {
        notes.push(UI.el("p", { class: "small dim", text: "> no data.enc in this gist — the account is created here on submit." }));
      }
    }

    const form = UI.el("form", { novalidate: true }, [
      UI.el("h2", { text: "new account" }),
      UI.el("p", { class: "lead", text: "> no encrypted blob yet. choose a password. it cannot be recovered." }),
      ...notes,
      UI.el("div", { class: "field", style: "margin-top:16px" }, [
        UI.el("label", { text: "password" }), pw,
        UI.el("div", { class: "strength" }, [UI.el("div", { class: "strength-bar" }, [fill]), strengthText]),
      ]),
      UI.el("div", { class: "field" }, [UI.el("label", { text: "confirm" }), pw2]),
      error,
      problemSlot,
      UI.el("div", { style: "margin-top:14px" }, [submit]),
      credentialsButton(true),
      UI.el("p", { class: "lock-foot dim", text: "> forget it and the data is gone. permanently." }),
    ]);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.textContent = "";
      UI.clear(problemSlot);

      if (pw.value.length < 8) {
        error.textContent = "> password must be at least 8 characters.";
        return;
      }
      if (pw.value !== pw2.value) {
        error.textContent = "> passwords do not match.";
        return;
      }

      busy = true;
      busyButton(submit, "> deriving key…");
      try {
        const saltBytes = CryptoUtil.randomBytes(16);
        const saltB64 = CryptoUtil.bytesToBase64(saltBytes);
        const key = await CryptoUtil.deriveKey(pw.value, saltBytes);
        const initial = Store.buildInitialState();
        const enc = await CryptoUtil.encryptJSON(initial, key);
        const result = await GistAPI.write({
          salt: saltB64,
          iv: enc.iv,
          ciphertext: enc.ciphertext,
        });

        if (!result.ok) {
          error.textContent = "> account NOT created — nothing was saved.";
          problemSlot.appendChild(inlineProblem(result.error || new Error("write failed")));
          return;
        }

        const keyB64 = await CryptoUtil.exportKey(key);
        writeSession(keyB64, saltB64);
        unlock(key, saltB64, initial, result.revision);
      } catch (err) {
        error.textContent = "> " + (err && err.message ? err.message : "setup failed");
        problemSlot.appendChild(inlineProblem(err));
      } finally {
        busy = false;
        idleButton(submit);
      }
    });

    setLock([form]);
    pw.focus();
  }

  function renderLogin(res) {
    const pw = UI.el("input", {
      class: "input", type: "password", placeholder: "password",
      autocomplete: "current-password", "aria-label": "Password",
    });
    const error = UI.el("div", { class: "form-error" });
    const submit = UI.el("button", {
      class: "btn btn-primary btn-block", type: "submit", text: "Unlock",
    });

    const form = UI.el("form", { novalidate: true }, [
      UI.el("h2", { text: "locked" }),
      UI.el("p", { class: "lead", text: "> encrypted store found. enter password to decrypt." }),
      res && res.gist ? gistLine(res.gist) : null,
      UI.el("div", { class: "field", style: "margin-top:16px" }, [
        UI.el("label", { text: "password" }), pw,
      ]),
      error,
      UI.el("div", { style: "margin-top:14px" }, [submit]),
      credentialsButton(true),
      UI.el("p", { class: "lock-foot dim", text: "> there is no password recovery." }),
    ]);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.textContent = "";
      if (!pw.value) {
        error.textContent = "> enter a password.";
        return;
      }

      busy = true;
      busyButton(submit, "> deriving key…");
      try {
        const fresh = await GistAPI.read();
        if (!fresh.exists) {
          error.textContent = "> data.enc disappeared from the gist. reload to re-check.";
          return;
        }
        const saltBytes = CryptoUtil.base64ToBytes(fresh.blob.salt);
        const key = await CryptoUtil.deriveKey(pw.value, saltBytes);
        let data;
        try {
          data = await CryptoUtil.decryptJSON(fresh.blob, key);
        } catch (e) {
          error.textContent = "> ACCESS DENIED — wrong password. the blob did not authenticate.";
          pw.value = "";
          pw.focus();
          return;
        }
        const keyB64 = await CryptoUtil.exportKey(key);
        writeSession(keyB64, fresh.blob.salt);
        unlock(key, fresh.blob.salt, data, fresh.revision);
      } catch (err) {
        if (err && err.code) {
          UI.clear(error);
          error.appendChild(inlineProblem(err));
        } else {
          error.textContent = "> " + (err && err.message ? err.message : "could not decrypt");
        }
      } finally {
        busy = false;
        idleButton(submit);
      }
    });

    setLock([form]);
    pw.focus();
  }

  function unlock(key, salt, data, revision) {
    Store.init(key, salt, data, revision);
    hideLock();
    App.start();
  }

  function logout() {
    clearSession();
    location.reload();
  }

  return { init, logout, clearSession };
})();
