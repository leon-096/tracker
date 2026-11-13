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

  /* Badge milestones key off habit tags, never display names. Tags are written
     once, then survive any rename; the keyword list is only used to migrate
     pre-tag datasets by their original seed names. */
  const TAG_RULES = [
    ["study block 1", "study_block_1"],
    ["study block 2", "study_block_2"],
    ["study block 3", "study_block_3"],
    ["tech project", "tech_project"],
    ["phone outside", "phone_outside"],
    ["no porn", "no_porn"],
    ["sleep time", "sleep_time"],
    ["wake time", "wake_time"],
    ["workout", "workout"],
    ["water", "water"],
    ["guitar", "guitar"],
    ["chess", "chess"],
    ["mood", "mood"],
    ["anxiety", "anxiety"],
  ];

  // Milestone tags read by at least one badge. The edit modal offers these so a
  // habit renamed before the tag migration can be reconnected.
  const MILESTONES = [
    { tag: "water", label: "Water", badge: "Hydrated" },
    { tag: "no_porn", label: "No porn", badge: "Clean Week / Month / Quarter" },
    { tag: "tech_project", label: "Tech project", badge: "Code Shipped" },
    { tag: "guitar", label: "Guitar", badge: "Strings" },
    { tag: "workout", label: "Workout", badge: "Mind & Body" },
    { tag: "mood", label: "Mood", badge: "Mind & Body" },
    { tag: "chess", label: "Chess", badge: "Chess Centurion" },
  ];

  let state = null;
  let key = null;
  let salt = null;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  let base = null;            // state as last read/written, for 3-way merge
  let baseRevision = "";      // gist revision that base corresponds to
  let overwriteRemote = false; // set by import/reset, which replace instead of merge
  const subscribers = new Set();
  const badgeHandlers = new Set();
  const mergeHandlers = new Set();

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "h-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function sanitizeTag(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  function makeTag() {
    return "custom_" + uid().replace(/-/g, "").slice(0, 8);
  }

  function inferTag(name) {
    const lower = String(name || "").toLowerCase();
    const match = TAG_RULES.find((rule) => lower.indexOf(rule[0]) !== -1);
    return match ? match[1] : "";
  }

  function seedHabits() {
    const now = new Date().toISOString();
    const defs = [
      ["Workout (20 min)", "boolean", null, null, null, "workout"],
      ["Study Block 1 (30 min)", "boolean", null, null, null, "study_block_1"],
      ["Study Block 2 (30 min)", "boolean", null, null, null, "study_block_2"],
      ["Study Block 3 (30 min)", "boolean", null, null, null, "study_block_3"],
      ["Tech Project (1 hr)", "boolean", null, null, null, "tech_project"],
      ["Phone Outside Bedroom", "boolean", null, null, null, "phone_outside"],
      ["No Porn", "boolean", null, null, null, "no_porn"],
      ["Sleep Time", "value", null, null, "time", "sleep_time"],
      ["Wake Time", "value", null, null, "time", "wake_time"],
      ["Water", "count", 8, "glasses", null, "water"],
      ["Guitar Practice", "boolean", null, null, null, "guitar"],
      ["Chess Games Played", "count", null, "games", null, "chess"],
      ["Mood", "value", 5, null, "number", "mood"],
      ["Anxiety Level", "value", 5, null, "number", "anxiety"],
    ];
    return defs.map((d, i) => ({
      id: uid(),
      name: d[0],
      type: d[1],
      frequency: "daily",
      target: d[2],
      unit: d[3],
      format: d[4],
      tag: d[5],
      color: PALETTE[i % PALETTE.length],
      xpPerCompletion: d[1] === "count" ? 5 : 10,
      createdAt: now,
      order: i,
      deleted: false,
    }));
  }

  function sanitizeHabit(h, usedTags) {
    const type = ["boolean", "count", "value"].indexOf(h.type) !== -1 ? h.type : "boolean";
    const parsedTarget = h.target === "" || h.target === undefined || h.target === null
      ? null
      : Number(h.target);
    const target = Number.isFinite(parsedTarget) ? parsedTarget : null;

    // Keep an existing tag verbatim; otherwise migrate by original seed name,
    // then fall back to a fresh unique custom tag.
    let tag = sanitizeTag(h.tag) || inferTag(h.name) || makeTag();
    while (usedTags.has(tag)) tag = makeTag();
    usedTags.add(tag);

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
      tag,
      order: Number.isFinite(h.order) ? h.order : 0,
      deleted: !!h.deleted,
    };
  }

  function normalize(input) {
    const data = input && typeof input === "object" ? input : {};
    const usedTags = new Set();
    const rawHabits = Array.isArray(data.habits)
      ? data.habits.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      : [];
    const habits = rawHabits.map((h) => sanitizeHabit(h, usedTags));
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

  /* ---------------------------------------------------------- sync merging */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function habitsById(list) {
    const map = {};
    for (const habit of list || []) map[habit.id] = habit;
    return map;
  }

  const MERGED_HABIT_FIELDS = [
    "name", "type", "target", "unit", "format", "color", "xpPerCompletion", "deleted",
  ];

  /* Apply only what changed between `before` and `mine` on top of `remote`.
     Everything else in `remote` — other devices' logs, habits, badges — is kept. */
  function applyLocalChanges(remote, before, mine) {
    const merged = clone(remote);
    if (!merged.logs || typeof merged.logs !== "object") merged.logs = {};
    if (!Array.isArray(merged.habits)) merged.habits = [];
    if (!Array.isArray(merged.badges)) merged.badges = [];

    const beforeHabits = habitsById(before.habits);
    const mineHabits = habitsById(mine.habits);
    const mergedHabits = habitsById(merged.habits);

    if (mine.title !== before.title) merged.title = mine.title;

    const beforeSettings = before.settings || {};
    const mineSettings = mine.settings || {};
    merged.settings = Object.assign({}, merged.settings || {});
    for (const setting of Object.keys(mineSettings)) {
      if (!sameValue(mineSettings[setting], beforeSettings[setting])) {
        merged.settings[setting] = mineSettings[setting];
      }
    }

    // Badges are cumulative: never drop one earned on another device.
    for (const badge of mine.badges || []) {
      if (merged.badges.indexOf(badge) === -1) merged.badges.push(badge);
    }

    for (const habit of mine.habits || []) {
      const existing = mergedHabits[habit.id];
      const original = beforeHabits[habit.id];

      if (!existing) {
        if (!original && !habit.deleted) {
          merged.habits.push(clone(habit));
          mergedHabits[habit.id] = habit;
        }
        continue;
      }
      if (!original) continue;

      for (const field of MERGED_HABIT_FIELDS) {
        if (!sameValue(habit[field], original[field])) existing[field] = habit[field];
      }
    }

    const dates = new Set([
      ...Object.keys(before.logs || {}),
      ...Object.keys(mine.logs || {}),
    ]);
    for (const date of dates) {
      const original = (before.logs || {})[date] || {};
      const current = (mine.logs || {})[date] || {};
      const ids = new Set([...Object.keys(original), ...Object.keys(current)]);

      for (const habitId of ids) {
        if (sameValue(current[habitId], original[habitId])) continue;
        const entries = merged.logs[date] || (merged.logs[date] = {});
        if (current[habitId] === undefined) delete entries[habitId];
        else entries[habitId] = current[habitId];
      }
      if (merged.logs[date] && Object.keys(merged.logs[date]).length === 0) {
        delete merged.logs[date];
      }
    }

    const orderOf = (snapshot) =>
      (snapshot.habits || []).slice().sort((a, b) => a.order - b.order).map((h) => h.id).join("|");
    if (orderOf(before) !== orderOf(mine)) {
      for (const habit of merged.habits) {
        const local = mineHabits[habit.id];
        if (local && Number.isFinite(local.order)) habit.order = local.order;
      }
    }

    merged.habits.sort((a, b) =>
      (a.order - b.order) || String(a.createdAt).localeCompare(String(b.createdAt))
    );
    merged.habits.forEach((habit, index) => { habit.order = index; });

    merged.version = 1;
    merged.createdAt = merged.createdAt || before.createdAt;
    return merged;
  }

  function init(newKey, saltB64, data, revision) {
    key = newKey;
    salt = saltB64;
    state = normalize(data);
    Gamify.recomputeXP(state);
    Gamify.evaluateBadges(state);
    base = clone(state);
    baseRevision = revision || "";
  }

  function onMerge(fn) {
    mergeHandlers.add(fn);
    return function () { mergeHandlers.delete(fn); };
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

    // Everything this session changed is captured by diffing snapshot vs base.
    const snapshot = clone(state);

    try {
      let payload = snapshot;
      let mergedRemote = false;
      let revision = baseRevision;
      let newBadges = [];

      if (!overwriteRemote) {
        const remote = await GistAPI.read();
        if (remote.exists) {
          revision = remote.revision || "";
          if (!baseRevision || revision !== baseRevision) {
            let remoteData;
            try {
              remoteData = await CryptoUtil.decryptJSON(remote.blob, key);
            } catch (e) {
              throw Object.assign(
                new Error("The gist changed and cannot be decrypted with this tab's key."),
                {
                  code: "ERR_REMOTE_UNREADABLE",
                  kind: "conflict",
                  retryable: false,
                  hints: ["Reload and unlock again before saving."],
                }
              );
            }
            payload = normalize(applyLocalChanges(remoteData, base, snapshot));
            Gamify.recomputeXP(payload);
            newBadges = Gamify.evaluateBadges(payload);
            mergedRemote = true;
          }
        }
      }

      const blob = await CryptoUtil.encryptJSON(payload, key);
      const result = await GistAPI.write({ salt, iv: blob.iv, ciphertext: blob.ciphertext });
      if (!result.ok) return;

      if (mergedRemote) {
        // Keep edits made while this save was in flight by replaying them
        // onto the merged result before showing it.
        const inFlight = clone(state);
        const adopted = applyLocalChanges(payload, snapshot, inFlight);
        Gamify.recomputeXP(adopted);
        newBadges = newBadges.concat(Gamify.evaluateBadges(adopted));
        state = adopted;
        emit();
        announceBadges(newBadges);
        mergeHandlers.forEach((fn) => {
          try { fn(); } catch (e) { console.error(e); }
        });
        if (!sameValue(inFlight, snapshot)) pendingSave = true;
      }

      base = clone(payload);
      baseRevision = result.revision || revision;
      overwriteRemote = false;
    } catch (err) {
      GistAPI.reportFailure(err);
    } finally {
      saving = false;
      if (pendingSave) { pendingSave = false; saveNow(); }
    }
  }

  function replaceAll(data) {
    state = normalize(data);
    Gamify.recomputeXP(state);
    announceBadges(Gamify.evaluateBadges(state));
    overwriteRemote = true;
    emit();
    scheduleSave();
  }

  function resetEverything() {
    state = buildInitialState();
    Gamify.recomputeXP(state);
    overwriteRemote = true;
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
    MILESTONES,
    sanitizeTag,
    uid,
    makeTag,
    buildInitialState,
    init,
    get,
    isReady,
    subscribe,
    onBadge,
    onMerge,
    mutate,
    replaceAll,
    resetEverything,
    setTitle,
    setSetting,
  };
})();
