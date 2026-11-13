/* auth.js — create-password / login flows and the session key cache.
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
    for (const node of nodes) body.appendChild(node);
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

  function showLock() {
    document.getElementById("lock-screen").hidden = false;
    document.getElementById("app").hidden = true;
  }

  function hideLock() {
    document.getElementById("lock-screen").hidden = true;
    document.getElementById("app").hidden = false;
  }

  function renderLoading() {
    setLock([
      UI.el("p", { class: "lead", text: "> opening encrypted store…" }),
      UI.el("div", { class: "loading" }, [UI.el("span", { text: "> contacting github" })]),
    ]);
  }

  function renderSetup() {
    setLock([
      UI.el("h2", { text: "setup required" }),
      UI.el("p", { class: "lead" }, [
        "Open ",
        UI.el("span", { style: "color:#ffb000", text: "js/config.js" }),
        " and fill in ",
        UI.el("span", { style: "color:#e0e0e0", text: "GIST_ID" }),
        " and ",
        UI.el("span", { style: "color:#e0e0e0", text: "GITHUB_TOKEN" }),
        ". See README.md for the walkthrough.",
      ]),
      UI.el("div", { class: "lock-foot dim" }, [
        UI.el("div", { text: "1. create a private gist → copy its id" }),
        UI.el("div", { text: "2. create a gist-scoped PAT → paste it in" }),
        UI.el("div", { text: "3. reload this page" }),
      ]),
    ]);
  }

  function renderError(message) {
    setLock([
      UI.el("h2", { text: "sync error" }),
      UI.el("p", { class: "lead", text: message || "Could not reach the gist." }),
      UI.el("button", {
        class: "btn btn-primary btn-block",
        type: "button",
        text: "Retry",
        onclick: () => init(),
      }),
    ]);
  }

  async function init() {
    showLock();
    if (!GistAPI.isConfigured()) {
      renderSetup();
      return;
    }

    renderLoading();
    let res;
    try {
      res = await GistAPI.read();
    } catch (err) {
      renderError(err && err.message ? err.message : "network error");
      return;
    }

    if (!res.exists) {
      renderCreate();
      return;
    }

    const session = readSession();
    if (session && session.salt === res.blob.salt) {
      try {
        const key = await CryptoUtil.importKey(session.key);
        const data = await CryptoUtil.decryptJSON(res.blob, key);
        unlock(key, res.blob.salt, data);
        return;
      } catch (e) {
        clearSession();
      }
    }

    renderLogin();
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

  function renderCreate() {
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
    const submit = UI.el("button", {
      class: "btn btn-primary btn-block", type: "submit", text: "Create password",
    });

    pw.addEventListener("input", () => {
      const s = CryptoUtil.passwordStrength(pw.value);
      fill.style.width = s.score + "%";
      fill.style.background = s.score >= 55 ? "var(--green)" : s.score >= 30 ? "var(--amber)" : "var(--err)";
      strengthText.textContent = "strength: " + (pw.value ? s.label : "—");
    });

    const form = UI.el("form", { novalidate: true }, [
      UI.el("h2", { text: "new account" }),
      UI.el("p", { class: "lead", text: "> no account exists yet. choose a password. it cannot be recovered." }),
      UI.el("div", { class: "field" }, [UI.el("label", { text: "password" }), pw,
        UI.el("div", { class: "strength" }, [UI.el("div", { class: "strength-bar" }, [fill]), strengthText])]),
      UI.el("div", { class: "field" }, [UI.el("label", { text: "confirm" }), pw2]),
      error,
      UI.el("div", { style: "margin-top:14px" }, [submit]),
      UI.el("p", { class: "lock-foot dim", text: "> forget it and the data is gone. permanently." }),
    ]);

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.textContent = "";

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
        const ok = await GistAPI.write({
          salt: saltB64,
          iv: enc.iv,
          ciphertext: enc.ciphertext,
        });

        if (!ok) {
          error.textContent = "> could not write to the gist. data was NOT saved. check config and retry.";
          return;
        }

        const keyB64 = await CryptoUtil.exportKey(key);
        writeSession(keyB64, saltB64);
        unlock(key, saltB64, initial);
      } catch (err) {
        error.textContent = "> " + (err && err.message ? err.message : "setup failed");
      } finally {
        busy = false;
        idleButton(submit);
      }
    });

    setLock([form]);
    pw.focus();
  }

  function renderLogin() {
    const pw = UI.el("input", {
      class: "input", type: "password", placeholder: "password",
      autocomplete: "current-password", "aria-label": "Password",
    });
    const error = UI.el("p", { class: "form-error" });
    const submit = UI.el("button", {
      class: "btn btn-primary btn-block", type: "submit", text: "Unlock",
    });

    const form = UI.el("form", { novalidate: true }, [
      UI.el("h2", { text: "locked" }),
      UI.el("p", { class: "lead", text: "> encrypted store found. enter password to decrypt." }),
      UI.el("div", { class: "field" }, [UI.el("label", { text: "password" }), pw]),
      error,
      UI.el("div", { style: "margin-top:14px" }, [submit]),
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
        const res = await GistAPI.read();
        if (!res.exists) {
          error.textContent = "> the encrypted store disappeared from the gist.";
          return;
        }
        const saltBytes = CryptoUtil.base64ToBytes(res.blob.salt);
        const key = await CryptoUtil.deriveKey(pw.value, saltBytes);
        let data;
        try {
          data = await CryptoUtil.decryptJSON(res.blob, key);
        } catch (e) {
          error.textContent = "> ACCESS DENIED — wrong password.";
          pw.value = "";
          pw.focus();
          return;
        }
        const keyB64 = await CryptoUtil.exportKey(key);
        writeSession(keyB64, res.blob.salt);
        unlock(key, res.blob.salt, data);
      } catch (err) {
        error.textContent = "> " + (err && err.message ? err.message : "could not decrypt");
      } finally {
        busy = false;
        idleButton(submit);
      }
    });

    setLock([form]);
    pw.focus();
  }

  function unlock(key, salt, data) {
    Store.init(key, salt, data);
    hideLock();
    App.start();
  }

  function logout() {
    clearSession();
    App.teardown();
    location.reload();
  }

  return { init, logout, clearSession };
})();
