/* habits.js — habit CRUD, ordering and daily logging handlers.
   All logging returns the XP delta so the caller can show "> +10 XP".        */
window.Habits = (function () {
  "use strict";

  function all() {
    const state = Store.get();
    return (state.habits || []).slice().sort((a, b) => a.order - b.order);
  }

  function active() {
    return all().filter((h) => !h.deleted);
  }

  function get(id) {
    return (Store.get().habits || []).find((h) => h.id === id) || null;
  }

  function setValue(date, habitId, value) {
    const state = Store.get();
    const before = Gamify.dayXp(state, date);

    Store.mutate((s) => {
      s.logs[date] = s.logs[date] || {};
      if (value === null || value === undefined || value === false) {
        delete s.logs[date][habitId];
      } else {
        s.logs[date][habitId] = value;
      }
      if (Object.keys(s.logs[date]).length === 0) delete s.logs[date];
    });

    return Gamify.dayXp(state, date) - before;
  }

  function toggle(date, habitId) {
    const state = Store.get();
    const entries = (state.logs || {})[date] || {};
    const current = entries[habitId] === true;
    return setValue(date, habitId, current ? null : true);
  }

  function step(date, habitId, delta) {
    const state = Store.get();
    const entries = (state.logs || {})[date] || {};
    const raw = Number(entries[habitId]);
    const current = Number.isFinite(raw) ? raw : 0;
    const next = Math.max(0, Math.min(999, current + delta));
    return setValue(date, habitId, next === 0 ? null : next);
  }

  function add(fields) {
    const list = all();
    const maxOrder = list.reduce((acc, h) => Math.max(acc, h.order), -1);
    const target = fields.target === null || fields.target === undefined || fields.target === ""
      ? null
      : Number(fields.target);
    const habit = {
      id: Store.uid(),
      name: String(fields.name || "Untitled").slice(0, 80),
      type: ["boolean", "count", "value"].indexOf(fields.type) !== -1 ? fields.type : "boolean",
      frequency: "daily",
      target: Number.isFinite(target) ? target : null,
      unit: fields.unit ? String(fields.unit).slice(0, 24) : null,
      format: fields.type === "value" && fields.format === "time" ? "time" : null,
      color: /^#[0-9a-f]{6}$/i.test(String(fields.color || "")) ? fields.color : "#00ff88",
      xpPerCompletion: fields.type === "count" ? 5 : 10,
      createdAt: new Date().toISOString(),
      order: maxOrder + 1,
      deleted: false,
    };

    Store.mutate((s) => {
      s.habits.push(habit);
      s.habits.sort((a, b) => a.order - b.order);
      s.habits.forEach((h, i) => { h.order = i; });
    });
    return habit;
  }

  function update(id, fields) {
    Store.mutate((s) => {
      const habit = s.habits.find((h) => h.id === id);
      if (!habit) return;
      habit.name = String(fields.name || habit.name).slice(0, 80);
      habit.type = fields.type || habit.type;
      habit.target = fields.target === null || fields.target === "" || fields.target === undefined ? null : Number(fields.target);
      habit.unit = fields.unit ? String(fields.unit).slice(0, 24) : null;
      habit.format = fields.format === "time" ? "time" : null;
      habit.color = fields.color || habit.color;
      habit.xpPerCompletion = habit.type === "count" ? 5 : 10;
    });
  }

  function remove(id) {
    Store.mutate((s) => {
      const habit = s.habits.find((h) => h.id === id);
      if (!habit) return;
      // History stays in s.logs so past graphs keep rendering.
      habit.deleted = true;
    });
  }

  function move(id, direction) {
    Store.mutate((s) => {
      const visible = s.habits.filter((h) => !h.deleted).sort((a, b) => a.order - b.order);
      const index = visible.findIndex((h) => h.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= visible.length) return;

      const current = visible[index];
      const neighbour = visible[target];
      const swap = current.order;
      current.order = neighbour.order;
      neighbour.order = swap;
      s.habits.sort((a, b) => a.order - b.order);
    });
  }

  function reorder(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    Store.mutate((s) => {
      const visible = s.habits.filter((h) => !h.deleted).sort((a, b) => a.order - b.order);
      const from = visible.findIndex((h) => h.id === draggedId);
      const to = visible.findIndex((h) => h.id === targetId);
      if (from === -1 || to === -1) return;
      const moved = visible.splice(from, 1)[0];
      visible.splice(to, 0, moved);
      const deleted = s.habits.filter((h) => h.deleted);
      s.habits = visible.concat(deleted);
      s.habits.forEach((h, i) => { h.order = i; });
    });
  }

  function nextColor() {
    const used = active().length;
    return Store.PALETTE[used % Store.PALETTE.length];
  }

  return { active, get, setValue, toggle, step, add, update, remove, move, reorder, nextColor };
})();
