/* app.js — routing, views, header, modals and event delegation. */
window.App = (function () {
  "use strict";

  const TABS = [
    { id: "today", label: "Today" },
    { id: "graphs", label: "Graphs" },
    { id: "heatmap", label: "Heatmap" },
    { id: "trophies", label: "Trophies" },
    { id: "manage", label: "Manage" },
    { id: "settings", label: "Settings" },
  ];

  const SECTIONS = {
    today: "view-today",
    graphs: "view-graphs",
    heatmap: "view-heatmap",
    trophies: "view-trophies",
    manage: "view-manage",
    settings: "view-settings",
  };

  let started = false;
  let current = "today";
  let date = DateUtil.today();
  let graph = { mode: "weekly", offset: 0, habitId: "all" };
  let lastLevel = 1;
  let dragId = null;
  let renderTimer = null;

  /* ------------------------------------------------------------------ boot */

  function start() {
    if (!Store.isReady()) return;

    date = DateUtil.today();
    lastLevel = Gamify.level(Store.get().xp.total);
    applyCrt();

    if (!started) {
      started = true;
      renderTabs();
      bindDelegates();
      Store.subscribe(onStoreChange);
      Store.onBadge((badge) =>
        UI.toast("> BADGE UNLOCKED — " + badge.name.toUpperCase(), "badge", 3200)
      );
      Store.onMerge(() => UI.toast("> merged changes from another device", "info", 2400));
      GistAPI.onStatus(onSyncStatus);
    }

    renderAll();
  }

  function applyCrt() {
    const crt = document.getElementById("crt");
    const st = Store.get();
    if (crt && st) crt.hidden = !(st.settings && st.settings.crt);
  }

  function timeInTz(d) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: DateUtil.TZ,
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(d);
    } catch (e) {
      return d.toTimeString().slice(0, 8);
    }
  }

  /* --------------------------------------------------------------- state UI */

  function onStoreChange() {
    const st = Store.get();
    if (!st) return;
    const lvl = Gamify.level(st.xp.total);
    if (lvl > lastLevel) UI.toast("> LEVEL UP — LVL " + lvl, "badge", 3000);
    lastLevel = lvl;
    applyCrt();
    renderHeaderOnly();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderActive, 0);
  }

  function onSyncStatus(status) {
    renderHeaderOnly();
    const node = document.getElementById("last-sync-time");
    if (node) node.textContent = status.lastOkAt ? timeInTz(status.lastOkAt) : "—";
  }

  function renderAll() {
    if (!Store.isReady()) return;
    renderHeaderOnly();
    renderTabsActive();
    renderActive();
  }

  function renderTabs() {
    const nav = document.getElementById("tabs");
    if (!nav) return;
    UI.clear(nav);
    for (const tab of TABS) {
      nav.appendChild(
        UI.el("button", {
          class: "tab", type: "button", "data-action": "tab", "data-tab": tab.id,
          text: tab.label,
        })
      );
    }
    renderTabsActive();
  }

  function renderTabsActive() {
    const nav = document.getElementById("tabs");
    if (!nav) return;
    Array.from(nav.querySelectorAll(".tab")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === current);
    });
  }

  function renderHeaderOnly() {
    const header = document.getElementById("app-header");
    const st = Store.get();
    if (!header || !st) return;

    const today = DateUtil.today();
    const lp = Gamify.levelProgress(st.xp.total);
    const cons = Gamify.consistency(st, today);
    const sync = GistAPI.getStatus();
    UI.clear(header);

    header.appendChild(UI.el("div", { class: "brand", text: "> " + st.title }));

    const stats = UI.el("div", { class: "header-stats" });
    stats.appendChild(UI.sparkline(Gamify.weekSeries(st, today)));

    stats.appendChild(
      UI.el("div", { class: "stat level", title: lp.total + " XP total — level " + lp.level }, [
        UI.el("span", { class: "stat-label", text: "LVL" }),
        UI.el("span", { class: "stat-value glow", text: String(lp.level) }),
      ])
    );

    stats.appendChild(
      UI.el("div", {
        class: "xp-bar",
        title: lp.into + " / " + lp.needed + " XP to LVL " + (lp.level + 1),
      }, [
        UI.el("div", {
          class: "xp-fill",
          style: "width:" + Math.min(100, (lp.into / lp.needed) * 100).toFixed(1) + "%",
        }),
        UI.el("span", { class: "xp-text", text: lp.into + "/" + lp.needed }),
      ])
    );

    stats.appendChild(
      UI.el("div", {
        class: "stat cons",
        title: "Consistency — % of daily habits completed in the last 7 days",
      }, [
        UI.el("span", { class: "stat-label", text: "CONS" }),
        UI.el("span", { class: "stat-value", text: cons + "%" }),
      ])
    );

    const dotClass = sync.status === "error" ? "error" : sync.status === "syncing" ? "syncing" : sync.status === "ok" ? "ok" : "";
    const dotTitle =
      sync.status === "error"
        ? "Sync failed " + (sync.code ? "[" + sync.code + "] " : "") + sync.message +
          (sync.retryable ? " — retrying" : " — will not retry; fix config")
        : sync.status === "syncing"
          ? "Syncing…"
          : sync.lastOkAt
            ? "Last synced " + timeInTz(sync.lastOkAt)
            : "Not synced yet";

    stats.appendChild(
      UI.el("span", {
        class: "sync-dot " + dotClass, role: "status",
        title: dotTitle, "aria-label": dotTitle,
      })
    );

    stats.appendChild(
      UI.el("button", { class: "logout", type: "button", text: "logout", "data-action": "logout" })
    );

    header.appendChild(stats);
  }

  function renderActive() {
    const st = Store.get();
    if (!st) return;

    Object.values(SECTIONS).forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
    });

    const section = document.getElementById(SECTIONS[current]);
    if (!section) return;
    section.hidden = false;

    if (current !== "graphs") Graphs.destroy();

    if (current === "today") renderToday(section, st);
    else if (current === "graphs") {
      Graphs.render(section, st, {
        mode: graph.mode,
        offset: graph.offset,
        habitId: graph.habitId,
        today: DateUtil.today(),
      });
    } else if (current === "heatmap") renderHeatmap(section, st);
    else if (current === "trophies") renderTrophies(section, st);
    else if (current === "manage") renderManage(section, st);
    else if (current === "settings") renderSettings(section, st);
  }

  function switchTab(id) {
    if (!SECTIONS[id]) return;
    current = id;
    renderTabsActive();
    renderActive();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setDate(next) {
    date = next;
    renderActive();
  }

  /* ---------------------------------------------------------------- today */

  function renderToday(section, st) {
    const today = DateUtil.today();
    const isFuture = date > today;
    const isToday = date === today;
    const progress = Gamify.dayProgress(st, date);
    const xpToday = Gamify.dayXp(st, date);
    const sync = GistAPI.getStatus();

    UI.clear(section);

    section.appendChild(
      UI.el("div", { class: "today-head" }, [
        UI.el("div", { class: "date-nav" }, [
          UI.el("button", {
            class: "nav-btn", type: "button", "data-action": "date-prev",
            "aria-label": "Previous day", html: "‹",
          }),
          UI.el("span", { class: "date-label", text: date + (isToday ? " · today" : "") }),
          UI.el("button", {
            class: "nav-btn", type: "button", "data-action": "date-next",
            "aria-label": "Next day", html: "›", disabled: isToday,
          }),
          UI.el("button", {
            class: "mini-btn", type: "button", "data-action": "date-today",
            text: "TODAY", disabled: isToday,
          }),
        ]),
        UI.el("div", { class: "sync-meta" }, [
          "last synced ",
          UI.el("span", { id: "last-sync-time", text: sync.lastOkAt ? timeInTz(sync.lastOkAt) : "—" }),
        ]),
      ])
    );

    if (isFuture) {
      section.appendChild(
        UI.el("div", { class: "locked-note", text: "> future dates are locked. go back to today to log." })
      );
    }

    section.appendChild(
      UI.el("div", { class: "today-top" }, [
        UI.ring(progress.percent, progress.percent + "%", progress.done + "/" + progress.total),
        UI.el("div", { class: "today-summary" }, [
          UI.el("div", { class: "big" }, [
            String(progress.done),
            UI.el("span", { text: "/" + progress.total }),
          ]),
          UI.el("div", { class: "dim", text: isToday ? "habits logged today" : "habits logged" }),
          UI.el("div", {
            class: "xp-today",
            text: "+" + xpToday + " XP" + (xpToday >= Gamify.DAY_CAP ? " · daily cap reached" : " · cap 120"),
          }),
        ]),
      ])
    );

    const list = UI.el("div", { class: "habit-list" });
    const habits = Habits.active();
    if (!habits.length) {
      list.appendChild(UI.el("div", { class: "empty", text: "> no habits yet. add some in Manage." }));
    }
    for (const habit of habits) {
      list.appendChild(habitRow(habit, st, date, isFuture));
    }
    section.appendChild(list);
  }

  function habitRow(habit, st, dateStr, disabled) {
    const entries = (st.logs || {})[dateStr] || {};
    const value = entries[habit.id];
    const logged = Gamify.isLogged(habit, value);

    const row = UI.el("div", {
      class: "habit-row" + (logged ? " done" : "") + (disabled ? " future" : ""),
      style: "--habit-color:" + habit.color,
      "data-habit": habit.id,
    });

    row.appendChild(
      UI.el("div", { class: "habit-info" }, [
        UI.el("span", { class: "habit-dot" }),
        UI.el("div", { class: "habit-text" }, [
          UI.el("div", { class: "habit-name", text: habit.name }),
          UI.el("div", { class: "habit-sub", text: subtitle(habit, value) }),
        ]),
      ])
    );

    row.appendChild(buildControl(habit, value, disabled));
    return row;
  }

  function subtitle(habit, value) {
    if (habit.type === "boolean") return "+10 XP";
    if (habit.type === "count") {
      const n = Number(value) || 0;
      const target = habit.target ? " / " + habit.target : "";
      return n + target + (habit.unit ? " " + habit.unit : "") + " · +5/unit";
    }
    if (habit.format === "time") return value ? "logged " + value : "not set";
    const has = value !== undefined && value !== null && value !== "";
    const target = habit.target ? " / " + habit.target : "";
    return (has ? value : "—") + target + " · +10 XP";
  }

  function buildControl(habit, value, disabled) {
    const wrap = UI.el("div", { class: "habit-control" });

    if (habit.type === "boolean") {
      const on = value === true;
      wrap.appendChild(
        UI.el("button", {
          class: "toggle" + (on ? " on" : ""), type: "button",
          "data-action": "toggle-habit", "data-id": habit.id,
          "aria-pressed": on ? "true" : "false",
          "aria-label": habit.name + (on ? " — done" : " — not done"),
          disabled,
        }, [
          UI.el("span", { class: "knob" }),
          UI.el("span", { class: "toggle-label", text: on ? "DONE" : "TODO" }),
        ])
      );
      return wrap;
    }

    if (habit.type === "count") {
      const n = Number(value) || 0;
      wrap.appendChild(
        UI.el("div", { class: "stepper" }, [
          UI.el("button", {
            class: "step-btn", type: "button", "data-action": "count-minus",
            "data-id": habit.id, "aria-label": "decrease", html: "−",
            disabled: disabled || n <= 0,
          }),
          UI.el("span", {
            class: "step-value" + (habit.target && n >= habit.target ? " hit" : ""),
            text: String(n),
          }),
          UI.el("button", {
            class: "step-btn", type: "button", "data-action": "count-plus",
            "data-id": habit.id, "aria-label": "increase", html: "+", disabled,
          }),
        ])
      );
      return wrap;
    }

    if (habit.format === "time") {
      wrap.appendChild(
        UI.el("input", {
          class: "time-input", type: "time", value: value || "",
          "data-role": "value-time", "data-id": habit.id,
          "aria-label": habit.name, disabled,
        })
      );
    } else {
      const max = Number(habit.target) || 10;
      const has = value !== undefined && value !== null && value !== "";
      const cur = has ? Number(value) : null;

      if (max <= 5) {
        const chips = UI.el("div", { class: "chips" });
        for (let i = 1; i <= max; i++) {
          chips.appendChild(
            UI.el("button", {
              class: "chip" + (cur === i ? " active" : ""), type: "button",
              "data-action": "value-set", "data-id": habit.id, "data-value": String(i),
              "aria-pressed": cur === i ? "true" : "false", text: String(i), disabled,
            })
          );
        }
        wrap.appendChild(chips);
      } else {
        wrap.appendChild(
          UI.el("div", { class: "range-wrap" }, [
            UI.el("input", {
              class: "range-input", type: "range", min: "1", max: String(max),
              value: String(cur || 1), "data-role": "value-range", "data-id": habit.id,
              "aria-label": habit.name, disabled,
            }),
            UI.el("span", { class: "range-value", text: cur ? String(cur) : "—" }),
          ])
        );
      }
    }

    wrap.appendChild(
      UI.el("button", {
        class: "clear-btn", type: "button", "data-action": "clear-value",
        "data-id": habit.id, "aria-label": "Clear value", html: "×",
        disabled: disabled || !Gamify.isLogged(habit, value),
      })
    );

    return wrap;
  }

  /* --------------------------------------------------------------- heatmap */

  function renderHeatmap(section, st) {
    UI.clear(section);
    const card = UI.el("div", { class: "card" });
    Heatmap.render(card, st);
    section.appendChild(card);
  }

  /* -------------------------------------------------------------- trophies */

  function renderTrophies(section, st) {
    UI.clear(section);
    const earned = (st.badges || []).length;
    const total = Gamify.BADGES.length;

    const card = UI.el("div", { class: "card" });
    card.appendChild(
      UI.el("div", { class: "card-title" }, [
        UI.el("span", { text: "// trophies" }),
        UI.el("span", { class: "dim", text: " — " + earned + " / " + total + " earned" }),
      ])
    );

    const grid = UI.el("div", { class: "badge-grid" });
    for (const badge of Gamify.BADGES) {
      const has = (st.badges || []).indexOf(badge.id) !== -1;
      grid.appendChild(
        UI.el("div", {
          class: "badge " + (has ? "earned" : "locked"),
          title: badge.condition + (has ? " — earned" : " — locked"),
        }, [
          UI.el("div", { class: "badge-icon", html: UI.icon(badge.icon, 22) }),
          UI.el("div", { class: "badge-name", text: badge.name }),
          UI.el("div", { class: "badge-cond", text: badge.condition }),
        ])
      );
    }
    card.appendChild(grid);
    card.appendChild(
      UI.el("p", { class: "dim small", style: "margin:14px 0 0" }, [
        "Cumulative milestones — nothing is ever revoked. A missed day just does not count.",
      ])
    );
    section.appendChild(card);
  }

  /* ---------------------------------------------------------------- manage */

  function typeLabel(habit) {
    if (habit.type === "boolean") return "boolean · +10 XP";
    if (habit.type === "count") {
      return "count" + (habit.target ? " · target " + habit.target : "") +
        (habit.unit ? " " + habit.unit : "") + " · +5/unit";
    }
    return habit.format === "time" ? "value · time of day · +10 XP" : "value · 1–" + (habit.target || 5) + " · +10 XP";
  }

  function renderManage(section, st) {
    UI.clear(section);
    const habits = Habits.active();

    const card = UI.el("div", { class: "card" });
    card.appendChild(
      UI.el("div", { class: "card-title" }, [
        UI.el("span", { text: "// habits" }),
        UI.el("span", { class: "dim", text: " — " + habits.length + " active" }),
      ])
    );

    const head = UI.el("div", { class: "setting-row" }, [
      UI.el("div", {}, [
        UI.el("div", { class: "setting-label", text: "Your daily habits" }),
        UI.el("div", { class: "setting-hint", text: "Reorder with the arrows or drag a row. Deleting keeps history." }),
      ]),
      UI.el("button", {
        class: "btn btn-primary", type: "button", "data-action": "habit-add",
        text: "+ Add habit",
      }),
    ]);
    card.appendChild(head);

    const list = UI.el("div", { class: "manage-list" });
    if (!habits.length) {
      list.appendChild(UI.el("div", { class: "empty", text: "> no habits. add one above." }));
    }

    habits.forEach((habit, index) => {
      const row = UI.el("div", {
        class: "manage-row", draggable: "true", "data-id": habit.id,
        style: "--habit-color:" + habit.color,
      }, [
        UI.el("span", { class: "drag-handle", text: "⋮⋮", "aria-hidden": "true" }),
        UI.el("span", { class: "habit-dot" }),
        UI.el("div", { class: "manage-info" }, [
          UI.el("div", { class: "habit-name", text: habit.name }),
          UI.el("div", { class: "habit-sub", text: typeLabel(habit) }),
        ]),
        UI.el("div", { class: "manage-actions" }, [
          UI.el("button", {
            class: "icon-btn", type: "button", "data-action": "habit-up",
            "data-id": habit.id, "aria-label": "Move up", html: UI.icon("up", 16),
            disabled: index === 0,
          }),
          UI.el("button", {
            class: "icon-btn", type: "button", "data-action": "habit-down",
            "data-id": habit.id, "aria-label": "Move down", html: UI.icon("down", 16),
            disabled: index === habits.length - 1,
          }),
          UI.el("button", {
            class: "icon-btn", type: "button", "data-action": "habit-edit",
            "data-id": habit.id, "aria-label": "Edit " + habit.name, html: UI.icon("edit", 16),
          }),
          UI.el("button", {
            class: "icon-btn danger", type: "button", "data-action": "habit-delete",
            "data-id": habit.id, "aria-label": "Delete " + habit.name, html: UI.icon("trash", 16),
          }),
        ]),
      ]);

      row.addEventListener("dragstart", (ev) => {
        dragId = habit.id;
        row.classList.add("dragging");
        try { ev.dataTransfer.setData("text/plain", habit.id); } catch (e) { /* ignore */ }
        ev.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        dragId = null;
        row.classList.remove("dragging");
        Array.from(list.children).forEach((c) => c.classList.remove("drag-over"));
      });
      row.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("drag-over");
        const from = (ev.dataTransfer && ev.dataTransfer.getData("text/plain")) || dragId;
        Habits.reorder(from, habit.id);
      });

      list.appendChild(row);
    });

    card.appendChild(list);
    section.appendChild(card);
  }

  /* -------------------------------------------------------------- settings */

  function settingRow(label, hint, control) {
    return UI.el("div", { class: "setting-row" }, [
      UI.el("div", {}, [
        UI.el("div", { class: "setting-label", text: label }),
        hint ? UI.el("div", { class: "setting-hint", text: hint }) : null,
      ]),
      UI.el("div", { class: "setting-control" }, control),
    ]);
  }

  function renderSettings(section, st) {
    UI.clear(section);

    const prefs = UI.el("div", { class: "card" });
    prefs.appendChild(UI.el("div", { class: "card-title", text: "// preferences" }));

    const titleInput = UI.el("input", {
      class: "input", type: "text", value: st.title, maxlength: "40",
      "data-role": "settings-title", "aria-label": "App title", style: "max-width:240px",
    });

    prefs.appendChild(settingRow("App title", "Shown in the header.", [titleInput]));

    prefs.appendChild(
      settingRow("CRT scanlines", "Optional overlay. Off by default.", [
        UI.el("button", {
          class: "switch" + (st.settings && st.settings.crt ? " on" : ""),
          type: "button", role: "switch",
          "aria-checked": st.settings && st.settings.crt ? "true" : "false",
          "aria-label": "Toggle CRT scanlines",
          "data-action": "toggle-crt",
        }),
      ])
    );

    section.appendChild(prefs);

    const data = UI.el("div", { class: "card" });
    data.appendChild(UI.el("div", { class: "card-title", text: "// data" }));

    const fileInput = UI.el("input", {
      type: "file", accept: "application/json,.json", id: "import-file", hidden: true,
    });

    data.appendChild(
      settingRow("Export", "Download the decrypted dataset as JSON.", [
        UI.el("button", {
          class: "btn btn-ghost", type: "button", "data-action": "export-data",
          html: UI.icon("download", 16) + " Export",
        }),
      ])
    );

    data.appendChild(
      settingRow("Import", "Upload a JSON export — replaces current data.", [
        fileInput,
        UI.el("button", {
          class: "btn btn-ghost", type: "button", "data-action": "import-data",
          html: UI.icon("upload", 16) + " Import",
        }),
      ])
    );

    data.appendChild(
      settingRow("Reset everything", "Wipes habits, logs, XP and badges. Double-confirmed. No undo.", [
        UI.el("button", {
          class: "btn btn-danger", type: "button", "data-action": "reset-data", text: "Reset",
        }),
      ])
    );

    section.appendChild(data);

    const creds = UI.el("div", { class: "card" });
    creds.appendChild(UI.el("div", { class: "card-title", text: "// connection" }));
    creds.appendChild(
      settingRow("Gist ID", "Where the encrypted blob lives.", [
        UI.el("span", { class: "mono-value", text: GistAPI.maskId(GistAPI.config.GIST_ID) }),
      ])
    );
    creds.appendChild(
      settingRow("Token", "Gist-scoped. Ships in the bundle by design.", [
        UI.el("span", { class: "mono-value", text: GistAPI.maskToken(GistAPI.config.GITHUB_TOKEN) }),
      ])
    );
    creds.appendChild(
      settingRow("Timezone", "All date logic is pinned here.", [
        UI.el("span", { class: "mono-value", text: DateUtil.TZ }),
      ])
    );
    section.appendChild(creds);

    const help = UI.el("div", { class: "card" });
    help.appendChild(UI.el("div", { class: "card-title", text: "// if the dark wave comes" }));
    help.appendChild(
      UI.el("div", { class: "helpline" }, [
        UI.el("div", { class: "num", text: "09612-119911" }),
        UI.el("div", { class: "note", text: "If the dark wave comes, call before anything else." }),
      ])
    );
    section.appendChild(help);
  }

  /* ---------------------------------------------------------------- modals */

  function openHabitModal(habitId) {
    const habit = habitId ? Habits.get(habitId) : null;
    const editing = !!habit && !habit.deleted;

    const name = UI.el("input", {
      class: "input", type: "text", value: habit ? habit.name : "",
      maxlength: "80", placeholder: "e.g. Workout (20 min)", "aria-label": "Habit name",
    });

    const type = UI.el("select", { class: "select", "aria-label": "Habit type" });
    [["boolean", "Boolean — toggle"], ["count", "Count — stepper"], ["value", "Value — range or time"]]
      .forEach(([v, l]) => type.appendChild(UI.el("option", { value: v, text: l })));
    type.value = habit ? habit.type : "boolean";

    const kind = UI.el("select", { class: "select", "aria-label": "Value format" });
    kind.appendChild(UI.el("option", { value: "number", text: "Number on a range (mood 1–5)" }));
    kind.appendChild(UI.el("option", { value: "time", text: "Time of day (HH:MM)" }));
    kind.value = habit && habit.format === "time" ? "time" : "number";

    const kindField = UI.el("div", { class: "field" }, [
      UI.el("label", { text: "value format" }), kind,
    ]);

    const target = UI.el("input", {
      class: "input", type: "number", min: "1", max: "999",
      value: habit && habit.target ? String(habit.target) : habit ? "" : "5",
      placeholder: "e.g. 8", "aria-label": "Target",
    });

    const targetField = UI.el("div", { class: "field" }, [
      UI.el("label", { text: "target / range max" }),
      target,
      UI.el("div", { class: "setting-hint", text: "count: the goal. value: the top of the scale." }),
    ]);

    const unit = UI.el("input", {
      class: "input", type: "text", value: habit && habit.unit ? habit.unit : "",
      placeholder: "glasses, games…", maxlength: "24", "aria-label": "Unit",
    });

    const color = UI.el("input", {
      class: "color-input", type: "color",
      value: habit ? habit.color : Habits.nextColor(), "aria-label": "Habit color",
    });

    const milestoneTags = Store.MILESTONES.map((m) => m.tag);
    const milestone = UI.el("select", { class: "select", "aria-label": "Milestone tag" });
    milestone.appendChild(UI.el("option", { value: "", text: "custom — no badge link" }));
    Store.MILESTONES.forEach((m) => {
      const owner = habit
        ? (Store.get().habits || []).find((h) => h.id !== habit.id && h.tag === m.tag)
        : null;
      milestone.appendChild(UI.el("option", {
        value: m.tag,
        text: m.label + " — " + m.badge + (owner ? " (used by " + owner.name + ")" : ""),
        disabled: !!owner,
      }));
    });
    if (habit && habit.tag && milestoneTags.indexOf(habit.tag) === -1 && habit.tag.indexOf("custom_") !== 0) {
      milestone.appendChild(UI.el("option", { value: habit.tag, text: "current — " + habit.tag }));
    }
    if (habit && habit.tag) milestone.value = habit.tag;

    const milestoneField = UI.el("div", { class: "field" }, [
      UI.el("label", { text: "milestone tag" }),
      milestone,
      UI.el("div", { class: "setting-hint", text: "reconnects a renamed habit to its badge. custom habits stay independent." }),
    ]);

    function syncFields() {
      kindField.hidden = type.value !== "value";
      targetField.hidden = !(type.value === "count" || (type.value === "value" && kind.value !== "time"));
    }
    type.addEventListener("change", syncFields);
    kind.addEventListener("change", syncFields);
    syncFields();

    const body = UI.el("div", {}, [
      UI.el("div", { class: "field" }, [UI.el("label", { text: "name" }), name]),
      UI.el("div", { class: "field" }, [UI.el("label", { text: "type" }), type]),
      kindField,
      targetField,
      UI.el("div", { class: "field" }, [UI.el("label", { text: "unit (optional)" }), unit]),
      UI.el("div", { class: "field" }, [
        UI.el("label", { text: "color" }),
        UI.el("div", { class: "color-row" }, [color]),
      ]),
      editing ? milestoneField : null,
    ]);

    UI.openModal({
      title: editing ? "edit habit" : "new habit",
      body,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (close) => close() },
        {
          label: editing ? "Save" : "Add habit",
          kind: "primary",
          onClick: (close) => {
            const trimmed = name.value.trim();
            if (!trimmed) {
              name.focus();
              UI.toast("> name required", "error", 1600);
              return;
            }
            const fields = {
              name: trimmed,
              type: type.value,
              format: type.value === "value" ? kind.value : null,
              target:
                type.value === "count" || (type.value === "value" && kind.value !== "time")
                  ? Number(target.value) || null
                  : null,
              unit: unit.value.trim() || null,
              color: color.value,
            };
            if (editing) {
              const nextTag = milestone.value;
              const currentTag = String(habit.tag || "");
              const tagChanged = nextTag === ""
                ? currentTag.indexOf("custom_") !== 0
                : nextTag !== currentTag;
              if (tagChanged) {
                const result = Habits.setTag(habit.id, nextTag);
                if (!result.ok) {
                  UI.toast(
                    "> milestone already used by " + (result.owner ? result.owner.name : "another habit"),
                    "error", 2400
                  );
                  return;
                }
              }
              Habits.update(habit.id, fields);
            } else {
              Habits.add(fields);
            }
            close();
          },
        },
      ],
      onMount: () => setTimeout(() => name.focus(), 30),
    });
  }

  function confirmDelete(habitId) {
    const habit = Habits.get(habitId);
    if (!habit) return;
    UI.openModal({
      title: "delete habit",
      body: UI.el("div", {}, [
        UI.el("p", { class: "small", text: '> delete "' + habit.name + '"?' }),
        UI.el("p", { class: "small dim", text: "> historical logs stay in the dataset, so past graphs still render. it just disappears from today." }),
      ]),
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (close) => close() },
        {
          label: "Delete", kind: "danger",
          onClick: (close) => {
            Habits.remove(habitId);
            close();
            UI.toast("> habit deleted", "info", 2000);
          },
        },
      ],
    });
  }

  /* -------------------------------------------------------------- settings ops */

  function exportData() {
    const data = JSON.stringify(Store.get(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "habit-tracker-" + DateUtil.today() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast("> exported", "info", 1800);
  }

  async function handleImport(file) {
    const input = document.getElementById("import-file");
    try {
      if (!file) return;
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.habits)) {
        throw new Error("not a tracker export");
      }
      const summary =
        parsed.habits.length + " habits · " +
        Object.keys(parsed.logs || {}).length + " logged days";

      UI.openModal({
        title: "import data",
        body: UI.el("p", { class: "small", text: "> replace everything with " + summary + "?" }),
        actions: [
          { label: "Cancel", kind: "ghost", onClick: (close) => close() },
          {
            label: "Replace", kind: "danger",
            onClick: (close) => {
              Store.replaceAll(parsed);
              close();
              UI.toast("> data imported", "info", 2400);
            },
          },
        ],
      });
    } catch (err) {
      UI.toast("> import failed — " + (err && err.message ? err.message : "bad file"), "error", 3200);
    } finally {
      if (input) input.value = "";
    }
  }

  function resetFlow() {
    UI.openModal({
      title: "reset everything",
      body: UI.el("div", {}, [
        UI.el("p", { class: "small", text: "> this deletes every habit, log, XP point and badge." }),
        UI.el("p", { class: "small dim", text: "> the password and gist stay. there is no undo." }),
      ]),
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (close) => close() },
        {
          label: "Continue", kind: "danger",
          onClick: (close) => { close(); resetConfirm(); },
        },
      ],
    });
  }

  function resetConfirm() {
    const input = UI.el("input", {
      class: "input", type: "text", placeholder: "type RESET",
      "aria-label": "Type RESET to confirm",
    });
    UI.openModal({
      title: "confirm reset",
      body: UI.el("div", {}, [
        UI.el("p", { class: "small", text: "> type RESET to wipe this tracker." }),
        input,
      ]),
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (close) => close() },
        {
          label: "Wipe data", kind: "danger",
          onClick: (close) => {
            if (input.value.trim().toUpperCase() !== "RESET") {
              UI.toast("> type RESET to confirm", "error", 1800);
              return;
            }
            close();
            Store.resetEverything();
            UI.toast("> data wiped", "info", 2200);
            renderAll();
          },
        },
      ],
      onMount: () => setTimeout(() => input.focus(), 30),
    });
  }

  /* ------------------------------------------------------------- delegation */

  function bindDelegates() {
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
  }

  function onClick(ev) {
    const target = ev.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    switch (action) {
      case "tab":
        switchTab(target.dataset.tab);
        break;

      case "logout":
        Auth.logout();
        break;

      case "date-prev":
        setDate(DateUtil.addDays(date, -1));
        break;

      case "date-next":
        if (date < DateUtil.today()) setDate(DateUtil.addDays(date, 1));
        break;

      case "date-today":
        setDate(DateUtil.today());
        break;

      case "toggle-habit": {
        const gained = Habits.toggle(date, id);
        const habit = Habits.get(id);
        const nowDone = habit && Gamify.isLogged(habit, (Store.get().logs[date] || {})[id]);
        if (gained > 0) UI.toast("> +" + gained + " XP", "xp", 1500);
        else if (nowDone) UI.toast("> logged — daily XP cap reached", "info", 1800);
        break;
      }

      case "count-plus":
        Habits.step(date, id, 1);
        break;

      case "count-minus":
        Habits.step(date, id, -1);
        break;

      case "value-set": {
        const gained = Habits.setValue(date, id, Number(target.dataset.value));
        if (gained > 0) UI.toast("> +" + gained + " XP", "xp", 1500);
        break;
      }

      case "clear-value":
        Habits.setValue(date, id, null);
        break;

      case "graph-mode":
        graph.mode = target.dataset.mode === "monthly" ? "monthly" : "weekly";
        graph.offset = 0;
        renderActive();
        break;

      case "graph-prev":
        graph.offset -= 1;
        renderActive();
        break;

      case "graph-next":
        if (graph.offset < 0) graph.offset += 1;
        renderActive();
        break;

      case "heatmap-day":
        date = target.dataset.date;
        current = "today";
        renderTabsActive();
        renderActive();
        break;

      case "habit-add":
        openHabitModal(null);
        break;

      case "habit-edit":
        openHabitModal(id);
        break;

      case "habit-delete":
        confirmDelete(id);
        break;

      case "habit-up":
        Habits.move(id, -1);
        break;

      case "habit-down":
        Habits.move(id, 1);
        break;

      case "toggle-crt":
        Store.setSetting("crt", !(Store.get().settings && Store.get().settings.crt));
        break;

      case "export-data":
        exportData();
        break;

      case "import-data": {
        const input = document.getElementById("import-file");
        if (input) input.click();
        break;
      }

      case "reset-data":
        resetFlow();
        break;

      case "modal-close":
        UI.closeModal();
        break;

      default:
        break;
    }
  }

  function onChange(ev) {
    const target = ev.target;

    if (target.matches('[data-role="value-time"]')) {
      Habits.setValue(date, target.dataset.id, target.value || null);
      return;
    }

    if (target.matches('[data-role="value-range"]')) {
      Habits.setValue(date, target.dataset.id, Number(target.value) || null);
      return;
    }

    if (target.matches('[data-role="graph-habit"]')) {
      graph.habitId = target.value;
      renderActive();
      return;
    }

    if (target.matches('[data-role="settings-title"]')) {
      Store.setTitle(target.value);
      return;
    }

    if (target.id === "import-file") {
      handleImport(target.files && target.files[0]);
    }
  }

  return { start, renderAll };
})();

(function boot() {
  function run() {
    if (!Store.isReady()) Auth.init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
