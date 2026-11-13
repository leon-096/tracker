/* graphs.js — Chart.js weekly / monthly renderers, filters and stats. */
window.Graphs = (function () {
  "use strict";

  let chart = null;
  let attempts = 0;

  function destroy() {
    if (chart) {
      try { chart.destroy(); } catch (e) { /* ignore */ }
      chart = null;
    }
    attempts = 0;
  }

  function periodFor(view) {
    if (view.mode === "monthly") {
      const base = DateUtil.addMonths(view.today, view.offset);
      const start = DateUtil.startOfMonth(base);
      let end = DateUtil.endOfMonth(base);
      if (view.offset === 0 && end > view.today) end = view.today;
      return { dates: DateUtil.daysBetweenList(start, end), label: DateUtil.monthLabel(start) };
    }

    const start = DateUtil.addDays(DateUtil.startOfWeek(view.today), view.offset * 7);
    const weekEnd = DateUtil.addDays(start, 6);
    const end = view.offset === 0 && weekEnd > view.today ? view.today : weekEnd;
    const dates = DateUtil.daysBetweenList(start, end);
    const label =
      start.slice(0, 7) === end.slice(0, 7)
        ? DateUtil.monthShort(start) + " " + DateUtil.dayNum(start) + "–" + DateUtil.dayNum(end)
        : DateUtil.monthShort(start) + " " + DateUtil.dayNum(start) + " – " +
          DateUtil.monthShort(end) + " " + DateUtil.dayNum(end);
    return { dates, label };
  }

  function tickLabel(dateStr, mode) {
    if (mode === "monthly") return String(DateUtil.dayNum(dateStr));
    return DateUtil.weekdayShort(dateStr);
  }

  function valueNumber(habit, value) {
    if (!Gamify.isLogged(habit, value)) return null;
    if (habit.format === "time") {
      const parts = String(value).split(":");
      if (parts.length !== 2) return null;
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return +(h + m / 60).toFixed(2);
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function buildSeries(state, dates, habit, mode) {
    const labels = dates.map((d) => tickLabel(d, mode));

    if (habit) {
      const vals = dates.map((d) => {
        const entries = state.logs[d] || {};
        const raw = entries[habit.id];
        if (!Gamify.isLogged(habit, raw)) return null;
        if (habit.type === "count") return Number(raw) || 0;
        if (habit.type === "value") return valueNumber(habit, raw);
        return 1;
      });
      return {
        labels,
        series: [
          {
            label: habit.name,
            data: vals,
            line: habit.type === "value",
            color: habit.color || "#00ff88",
          },
        ],
        counts: vals,
      };
    }

    const booleans = [];
    const counts = [];
    const values = [];
    const logged = [];

    for (const d of dates) {
      const habits = Gamify.activeHabits(state, d);
      const entries = state.logs[d] || {};
      let b = 0;
      let c = 0;
      let vSum = 0;
      let vCount = 0;
      let loggedCount = 0;

      for (const h of habits) {
        const raw = entries[h.id];
        if (!Gamify.isLogged(h, raw)) continue;
        loggedCount++;
        if (h.type === "boolean") b++;
        else if (h.type === "count") c += Number(raw) || 0;
        else if (h.type === "value" && h.format !== "time") {
          const n = Number(raw);
          if (Number.isFinite(n)) { vSum += n; vCount++; }
        }
      }

      booleans.push(b);
      counts.push(c);
      values.push(vCount ? +(vSum / vCount).toFixed(2) : null);
      logged.push(loggedCount);
    }

    return {
      labels,
      series: [
        { label: "Booleans done", data: booleans, line: false, color: "#00ff88", stack: "a" },
        { label: "Counts logged", data: counts, line: false, color: "#ffb000", stack: "a" },
        { label: "Value avg", data: values, line: true, color: "#66d9ff" },
      ],
      logged,
      counts,
    };
  }

  function buildStats(state, dates, habit, built) {
    if (habit) {
      if (habit.type === "count") {
        const total = built.counts.reduce((a, b) => a + (b || 0), 0);
        const best = bestIndex(built.counts);
        return {
          total: total,
          totalLabel: "total",
          avg: dates.length ? total / dates.length : 0,
          avgLabel: "units/day",
          best: best === -1 ? "—" : DateUtil.label(dates[best]) + " (" + built.counts[best] + ")",
        };
      }
      if (habit.type === "boolean") {
        const total = built.counts.filter((v) => v === 1).length;
        const best = bestIndex(built.counts);
        return {
          total,
          totalLabel: "days done",
          avg: dates.length ? (total / dates.length) * 100 : 0,
          avgLabel: "% of days",
          best: best === -1 ? "—" : DateUtil.label(dates[best]) + " (done)",
        };
      }
      const total = built.counts.filter((v) => v !== null).length;
      const best = bestIndex(built.counts);
      const bestVal = best === -1 ? null : built.counts[best];
      return {
        total,
        totalLabel: "days logged",
        avg: dates.length ? (total / dates.length) * 100 : 0,
        avgLabel: "% of days",
        best: best === -1 ? "—" : DateUtil.label(dates[best]) + " (" + bestVal + (habit.format === "time" ? "h" : "") + ")",
      };
    }

    const total = built.logged.reduce((a, b) => a + b, 0);
    const best = bestIndex(built.logged);
    return {
      total,
      totalLabel: "habit logs",
      avg: dates.length ? total / dates.length : 0,
      avgLabel: "logs/day",
      best: best === -1 ? "—" : DateUtil.label(dates[best]) + " (" + built.logged[best] + ")",
    };
  }

  function bestIndex(arr) {
    let best = -1;
    let bestVal = -1;
    arr.forEach((v, i) => {
      const n = v === null ? -1 : Number(v);
      if (n > bestVal) { bestVal = n; best = i; }
    });
    return bestVal > 0 ? best : -1;
  }

  function render(section, state, view) {
    destroy();
    UI.clear(section);

    const period = periodFor(view);
    const selected = view.habitId && view.habitId !== "all" ? Habits.get(view.habitId) : null;
    const habit = selected && !selected.deleted ? selected : null;
    const activeHabits = Habits.active();

    /* toolbar */
    const toolbar = UI.el("div", { class: "graph-toolbar" });

    const seg = UI.el("div", { class: "seg", role: "group", "aria-label": "Period size" });
    for (const mode of [{ id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }]) {
      seg.appendChild(
        UI.el("button", {
          class: "seg-btn" + (view.mode === mode.id ? " active" : ""),
          type: "button",
          "data-action": "graph-mode",
          "data-mode": mode.id,
          text: mode.label,
        })
      );
    }
    toolbar.appendChild(seg);

    toolbar.appendChild(
      UI.el("div", { class: "date-nav" }, [
        UI.el("button", {
          class: "nav-btn", type: "button", "data-action": "graph-prev",
          "aria-label": "Previous period", html: "‹",
        }),
        UI.el("span", { class: "date-label", text: period.label }),
        UI.el("button", {
          class: "nav-btn", type: "button", "data-action": "graph-next",
          "aria-label": "Next period", html: "›", disabled: view.offset >= 0,
        }),
      ])
    );

    const select = UI.el("select", {
      class: "select", "data-role": "graph-habit", "aria-label": "Filter by habit",
    });
    select.appendChild(UI.el("option", { value: "all", text: "All habits" }));
    for (const h of activeHabits) {
      select.appendChild(UI.el("option", { value: h.id, text: h.name }));
    }
    select.value = habit ? habit.id : "all";
    toolbar.appendChild(select);
    section.appendChild(toolbar);

    const built = buildSeries(state, period.dates, habit, view.mode);
    const stats = buildStats(state, period.dates, habit, built);

    const chartWrap = UI.el("div", { class: "chart-wrap" });
    const canvas = UI.el("canvas", { role: "img", "aria-label": "Habit chart" });
    chartWrap.appendChild(canvas);
    section.appendChild(chartWrap);

    section.appendChild(
      UI.el("div", { class: "stats-row" }, [
        statBox("total", String(stats.total), stats.totalLabel),
        statBox("avg / day", Number(stats.avg).toFixed(stats.avgLabel.indexOf("%") !== -1 ? 0 : 1), stats.avgLabel),
        statBox("best day", stats.best, ""),
      ])
    );

    const mono = '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace';
    const hasLine = built.series.some((s) => s.line);
    const datasets = built.series.map((s) => {
      if (s.line) {
        return {
          type: "line",
          label: s.label,
          data: s.data,
          yAxisID: "y1",
          borderColor: s.color,
          backgroundColor: "rgba(102, 217, 255, 0.12)",
          tension: 0.3,
          spanGaps: true,
          pointRadius: 3,
          pointBackgroundColor: s.color,
          borderWidth: 2,
          fill: false,
        };
      }
      return {
        type: "bar",
        label: s.label,
        data: s.data,
        stack: s.stack,
        backgroundColor: s.color === "#00ff88" ? "rgba(0, 255, 136, 0.5)" : "rgba(255, 176, 0, 0.45)",
        borderColor: s.color,
        borderWidth: 1,
        borderRadius: 2,
      };
    });

    const scales = {
      x: {
        grid: { color: "rgba(255,255,255,0.04)" },
        ticks: { color: "#666", font: { family: mono, size: 9 }, maxRotation: 0, autoSkip: true },
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: { color: "#666", font: { family: mono, size: 9 }, precision: 0 },
      },
    };
    if (hasLine) {
      scales.y1 = {
        position: "right",
        beginAtZero: true,
        suggestedMax: 5,
        grid: { display: false },
        ticks: { color: "#66d9ff", font: { family: mono, size: 9 }, precision: 0 },
      };
    }

    const config = {
      type: "bar",
      data: { labels: built.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: "#888", boxWidth: 10, boxHeight: 10,
              font: { family: mono, size: 10 }, usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: "#050505",
            borderColor: "rgba(0, 255, 136, 0.35)",
            borderWidth: 1,
            titleColor: "#e0e0e0",
            bodyColor: "#cfcfcf",
            titleFont: { family: mono, size: 11 },
            bodyFont: { family: mono, size: 11 },
            padding: 10,
            callbacks: {
              title: (items) => (items.length ? period.dates[items[0].dataIndex] : ""),
            },
          },
        },
        scales,
      },
    };

    drawWhenReady(section, config);
  }

  function drawWhenReady(section, config) {
    if (!window.Chart) {
      if (attempts++ < 5) {
        setTimeout(() => {
          if (section.querySelector("canvas")) drawWhenReady(section, config);
        }, 600);
      } else {
        const wrap = section.querySelector(".chart-wrap");
        if (wrap) {
          UI.clear(wrap);
          wrap.appendChild(UI.el("p", { class: "dim small", text: "> chart library failed to load (offline?)." }));
        }
      }
      return;
    }

    const canvas = section.querySelector("canvas");
    if (!canvas || !canvas.isConnected) return;
    try {
      chart = new Chart(canvas.getContext("2d"), config);
    } catch (err) {
      console.error(err);
      UI.toast("> chart error", "error", 2500);
    }
  }

  function statBox(label, value, unit) {
    const box = UI.el("div", { class: "stat-box" }, [
      UI.el("div", { class: "stat-k", text: label }),
      UI.el("div", { class: "stat-v" }),
    ]);
    const v = box.querySelector(".stat-v");
    v.appendChild(document.createTextNode(value));
    if (unit) v.appendChild(UI.el("small", { text: " " + unit }));
    return box;
  }

  return { render, destroy };
})();
