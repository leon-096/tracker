/* gamify.js — XP, levels, badges and the consistency score.
   XP is recomputed deterministically from logs so the daily cap can never
   be farmed and reloading never drifts:
     boolean -> 10 XP, value -> 10 XP, count -> 5 XP/unit (max 50 per habit/day)
     hard daily cap of 120 XP.
   Badges are cumulative milestones, never revoked.                              */
window.Gamify = (function () {
  "use strict";

  const DAY_CAP = 120;
  const COUNT_XP_PER_UNIT = 5;
  const COUNT_XP_CAP = 50;
  const VALUE_XP = 10;

  function isLogged(habit, value) {
    if (value === undefined || value === null || value === "" || value === false) return false;
    if (habit.type === "boolean") return value === true;
    if (habit.type === "count") return Number(value) > 0;
    return true;
  }

  function habitXp(habit, value) {
    if (!isLogged(habit, value)) return 0;
    if (habit.type === "count") {
      const n = Math.max(0, Math.floor(Number(value) || 0));
      return Math.min(COUNT_XP_CAP, n * COUNT_XP_PER_UNIT);
    }
    if (habit.type === "value") return VALUE_XP;
    const custom = Number(habit.xpPerCompletion);
    return Number.isFinite(custom) ? custom : 10;
  }

  function findHabit(state, id) {
    return (state.habits || []).find((h) => h.id === id) || null;
  }

  function dayXp(state, date) {
    const entries = (state.logs || {})[date];
    if (!entries) return 0;
    let sum = 0;
    for (const id of Object.keys(entries)) {
      const habit = findHabit(state, id);
      if (habit) sum += habitXp(habit, entries[id]);
    }
    return Math.min(DAY_CAP, sum);
  }

  function recomputeXP(state) {
    const byDay = {};
    let total = 0;
    const logs = state.logs || {};
    for (const date of Object.keys(logs).sort()) {
      const xp = dayXp(state, date);
      if (xp > 0) {
        byDay[date] = xp;
        total += xp;
      }
    }
    state.xp = { total, byDay };
    return state.xp;
  }

  function level(total) {
    return Math.floor((Number(total) || 0) / 1000) + 1;
  }

  function levelProgress(total) {
    const t = Number(total) || 0;
    return { level: level(t), into: t % 1000, needed: 1000, total: t };
  }

  /* --- day-level helpers ------------------------------------------------- */

  function activeHabits(state, date) {
    return (state.habits || []).filter((h) => {
      if (h.deleted) return false;
      if (!date) return true;
      return DateUtil.fromISO(h.createdAt) <= date;
    });
  }

  function dayProgress(state, date) {
    const habits = activeHabits(state, date);
    const entries = (state.logs || {})[date] || {};
    let done = 0;
    for (const h of habits) {
      if (isLogged(h, entries[h.id])) done++;
    }
    return {
      done,
      total: habits.length,
      percent: habits.length ? Math.round((done / habits.length) * 100) : 0,
      entries,
      habits,
    };
  }

  function consistency(state, today) {
    let done = 0;
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const p = dayProgress(state, DateUtil.addDays(today, -i));
      done += p.done;
      total += p.total;
    }
    return total ? Math.round((done / total) * 100) : 0;
  }

  function weekSeries(state, today) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const date = DateUtil.addDays(today, -i);
      const p = dayProgress(state, date);
      out.push({ date, percent: p.percent, done: p.done, total: p.total });
    }
    return out;
  }

  /* --- badges ------------------------------------------------------------ */

  const BADGES = [
    { id: "first_step", name: "First Step", condition: "Log any habit", icon: "footprint",
      check: (c) => c.loggedDates >= 1 },
    { id: "week_one", name: "Week One", condition: "7 days with 5+ habits logged", icon: "calendar",
      check: (c) => c.days5 >= 7 },
    { id: "code_shipped", name: "Code Shipped", condition: "7 days with Tech Project logged", icon: "code",
      check: (c) => c.techDays >= 7 },
    { id: "chess_centurion", name: "Chess Centurion", condition: "100 total chess games logged", icon: "chess",
      check: (c) => c.chessGames >= 100 },
    { id: "hydrated", name: "Hydrated", condition: "30 days hitting the water target", icon: "drop",
      check: (c) => c.waterDays >= 30 },
    { id: "strings", name: "Strings", condition: "14 days of Guitar Practice logged", icon: "guitar",
      check: (c) => c.guitarDays >= 14 },
    { id: "mind_body", name: "Mind & Body", condition: "30 days with Workout and Mood logged", icon: "heart",
      check: (c) => c.mindBodyDays >= 30 },
    { id: "level_5", name: "Level 5", condition: "Reach level 5", icon: "bolt",
      check: (c) => c.level >= 5 },
    { id: "level_10", name: "Level 10", condition: "Reach level 10", icon: "bolt",
      check: (c) => c.level >= 10 },
    { id: "level_25", name: "Level 25", condition: "Reach level 25", icon: "bolt",
      check: (c) => c.level >= 25 },
    { id: "level_50", name: "Level 50", condition: "Reach level 50", icon: "bolt",
      check: (c) => c.level >= 50 },
    { id: "clean_week", name: "Clean Week", condition: "7 cumulative no-porn days", icon: "shield",
      check: (c) => c.cleanDays >= 7 },
    { id: "clean_month", name: "Clean Month", condition: "30 cumulative no-porn days", icon: "shield",
      check: (c) => c.cleanDays >= 30 },
    { id: "clean_quarter", name: "Clean Quarter", condition: "90 cumulative no-porn days", icon: "shield",
      check: (c) => c.cleanDays >= 90 },
  ];

  function badgeContext(state) {
    const logs = state.logs || {};
    const byName = (needle) =>
      (state.habits || []).find((h) => h.name.toLowerCase().includes(needle)) || null;

    const tech = byName("tech project");
    const water = byName("water");
    const guitar = byName("guitar");
    const workout = byName("workout");
    const mood = byName("mood");
    const porn = byName("no porn");
    const chess = byName("chess");

    let loggedDates = 0;
    let days5 = 0;
    let techDays = 0;
    let waterDays = 0;
    let guitarDays = 0;
    let mindBodyDays = 0;
    let cleanDays = 0;
    let chessGames = 0;

    for (const date of Object.keys(logs)) {
      const entries = logs[date] || {};
      let count = 0;
      for (const id of Object.keys(entries)) {
        const h = findHabit(state, id);
        if (h && isLogged(h, entries[id])) count++;
      }
      if (count > 0) loggedDates++;
      if (count >= 5) days5++;
      if (tech && entries[tech.id] === true) techDays++;
      if (water && water.target && Number(entries[water.id]) >= Number(water.target)) waterDays++;
      if (guitar && entries[guitar.id] === true) guitarDays++;
      if (workout && entries[workout.id] === true && mood && isLogged(mood, entries[mood.id])) mindBodyDays++;
      if (porn && entries[porn.id] === true) cleanDays++;
      if (chess) chessGames += Number(entries[chess.id]) || 0;
    }

    return {
      loggedDates, days5, techDays, waterDays, guitarDays, mindBodyDays,
      cleanDays, chessGames,
      level: level((state.xp || {}).total || 0),
    };
  }

  function evaluateBadges(state) {
    if (!Array.isArray(state.badges)) state.badges = [];
    const ctx = badgeContext(state);
    const earned = [];
    for (const badge of BADGES) {
      if (state.badges.indexOf(badge.id) === -1 && badge.check(ctx)) {
        state.badges.push(badge.id);
        earned.push(badge);
      }
    }
    return earned;
  }

  return {
    DAY_CAP,
    isLogged,
    dayXp,
    recomputeXP,
    level,
    levelProgress,
    activeHabits,
    dayProgress,
    consistency,
    weekSeries,
    BADGES,
    evaluateBadges,
  };
})();
