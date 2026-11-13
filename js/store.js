/* store.js — in-memory state + encrypted persistence to the Gist.
   Mutations update memory immediately (optimistic UI), then re-encrypt and
   PATCH the gist after a 500ms debounce.                                     */
window.Store = (function () {
  "use strict";

  const PALETTE = [
    "#00ff88", "#ffb000", "#66d9ff", "#ff7ab6", "#b388ff",
    "#00e0c6", "#ffd166", "#ff8a5c", "#9ae66e", "#7aa2ff",
    "#ff5c8a", "#c7f464", "#8be9fd", "#ffb86c",
  ];

  let state = null;
  let key = null;
  let salt = null;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  const subscribers = new Set();
  const badgeHandlers = new Set();

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "h-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function seedHabits() {
    const now = new Date().toISOString();
    const defs = [
      ["Workout (20 min)", "boolean", null, null, null],
      ["Study Block 1 (30 min)", "boolean", null, null, null],
      ["Study Block 2 (30 min)", "boolean", null, null, null],
      ["Study Block 3 (30 min)", "boolean", null, null, null],
      ["Tech Project (1 hr)", "boolean", null, null, null],
      ["Phone Outside Bedroom", "boolean", null, null, null],
      ["No Porn", "boolean", null, null, null],
      ["Sleep Time", "value", null, null, "time"],
      ["Wake Time", "value", null, null, "time"],
      ["Water", "count", 8, "glasses", null],
      ["Guitar Practice", "boolean", null, null, null],
      ["Chess Games Played", "count", null, "games", null],
      ["Mood", "value", 5, null, "number"],
      ["Anxiety Level", "value", 5, null, "number"],
    ];
    return defs.map((d, i) => ({
      id: uid(),
      name: d[0],
      type: d[1],
      frequency: "daily",
      target: d[2],
      unit: d[3],
      format: d[4],
      color: PALETTE[i % PALETTE.length],
      xpPerCompletion: d[1] === "count" ? 5 : 10,
      createdAt: now,
      order: i,
      deleted: false,
    }));
  }

  function sanitizeHabit(h) {
    const type = ["boolean", "count", "value"].indexOf(h.type) !== -1 ? h.type : "boolean";
    const parsedTarget = h.target === "" || h.target === undefined || h.target === null
      ? null
      : Number(h.target);
    const target = Number.isFinite(parsedTarget) ? parsedTarget : null;
    return {
      id: h.id ? String(h.id) : uid(),
      name: String(h.name || "Untitled").slice(0, 80),
      type,
      frequency: "daily",
      target,
      unit: h.unit ? String(h.unit).slice(0, 24) : null,
      format: h.format === "time" ? "time" : null,
      color: /^#[0-9a-f]{6}$/i.test(String(h.color || "")) ? h.color : "#00ff88",
      xpPerCompletion: Number(h.xpPerCompletion) || (type === "count" ? 5 : 10),
      createdAt: h.createdAt || new Date().toISOString(),
      order: Number.isFinite(h.order) ? h.order : 0,
      deleted: !!h.deleted,
    };
  }

  function normalize(input) {
    const data = input && typeof input === "object" ? input : {};
    const habits = Array.isArray(data.habits) ? data.habits.map(sanitizeHabit) : [];
    habits.sort((a, b) => a.order - b.order);
    habits.forEach((h, i) => { h.order = i; });

    return {
      version: 1,
      createdAt: data.createdAt || new Date().toISOString(),
      habits,
      logs: data.logs && typeof data.logs === "object" && !Array.isArray(data.logs) ? data.logs : {},
      xp: { total: 0, byDay: {} },
      badges: Array.isArray(data.badges) ? data.badges.filter((b) => typeof b === "string") : [],
      title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 40) : "tracker",
      settings: Object.assign({ crt: false }, data.settings || {}),
    };
  }

  function buildInitialState() {
    return normalize({ habits: seedHabits(), createdAt: new Date().toISOString() });
  }

  function init(newKey, saltB64, data) {
    key = newKey;
    salt = saltB64;
    state = normalize(data);
    Gamify.recomputeXP(state);
    Gamify.evaluateBadges(state);
  }

  function get() { return state; }
  function isReady() { return !!state; }
  function subscribe(fn) {
    subscribers.add(fn);
    return function () { subscribers.delete(fn); };
  }

  function onBadge(fn) {
    badgeHandlers.add(fn);
    return function () { badgeHandlers.delete(fn); };
  }

  function emit() {
    subscribers.forEach((fn) => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function announceBadges(earned) {
    for (const badge of earned) {
      badgeHandlers.forEach((fn) => {
        try { fn(badge); } catch (e) { console.error(e); }
      });
    }
  }

  function afterChange() {
    Gamify.recomputeXP(state);
    announceBadges(Gamify.evaluateBadges(state));
    emit();
    scheduleSave();
  }

  function mutate(fn) {
    fn(state);
    afterChange();
  }

  function scheduleSave() {
    if (!key) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  async function saveNow() {
    if (!key || !state) return;
    clearTimeout(saveTimer);
    if (saving) { pendingSave = true; return; }
    saving = true;
    pendingSave = false;
    try {
      const blob = await CryptoUtil.encryptJSON(state, key);
      await GistAPI.write({ salt, iv: blob.iv, ciphertext: blob.ciphertext });
    } catch (e) {
      /* GistAPI already reported the failure via sync status */
    } finally {
      saving = false;
      if (pendingSave) { pendingSave = false; saveNow(); }
    }
  }

  function replaceAll(data) {
    state = normalize(data);
    Gamify.recomputeXP(state);
    announceBadges(Gamify.evaluateBadges(state));
    emit();
    scheduleSave();
  }

  function resetEverything() {
    state = buildInitialState();
    Gamify.recomputeXP(state);
    emit();
    scheduleSave();
  }

  function setTitle(title) {
    const clean = String(title || "").trim().slice(0, 40) || "tracker";
    if (clean === state.title) return;
    mutate((s) => { s.title = clean; });
  }

  function setSetting(name, value) {
    mutate((s) => {
      s.settings = s.settings || {};
      s.settings[name] = value;
    });
  }

  return {
    PALETTE,
    uid,
    buildInitialState,
    init,
    get,
    isReady,
    subscribe,
    onBadge,
    mutate,
    replaceAll,
    resetEverything,
    setTitle,
    setSetting,
  };
})();
