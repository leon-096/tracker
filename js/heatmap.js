/* heatmap.js — GitHub-style 53 × 7 grid for the last 365 days (Asia/Dhaka). */
window.Heatmap = (function () {
  "use strict";

  const COLUMNS = 53;
  const ROWS = 7;
  const COLORS = [
    { max: 0, color: "#141414" },
    { max: 25, color: "#0d3d22" },
    { max: 50, color: "#1a8842" },
    { max: 75, color: "#33cc66" },
    { max: 100, color: "#00ff88" },
  ];

  function colorFor(percent) {
    if (percent <= 0) return COLORS[0].color;
    for (const band of COLORS) {
      if (percent <= band.max && band.max > 0) return band.color;
    }
    return COLORS[COLORS.length - 1].color;
  }

  function render(container, state) {
    UI.clear(container);
    const today = DateUtil.today();
    // Sunday on/before (today - 364 days), so the grid always ends in the
    // current week and covers at least a full year.
    const offsetDays = 52 * 7 + DateUtil.dow(today);
    const start = DateUtil.addDays(today, -offsetDays);

    const head = UI.el("div", { class: "heat-head" }, [
      UI.el("div", { class: "card-title", text: "// last 365 days" }),
      UI.el("div", { class: "heat-legend" }, [
        UI.el("span", { class: "dim", text: "less" }),
        ...COLORS.map((band) =>
          UI.el("span", { class: "heat-swatch", style: "background:" + band.color })
        ),
        UI.el("span", { class: "dim", text: "more" }),
      ]),
    ]);

    const monthsRow = UI.el("div", { class: "heat-months" });
    const grid = UI.el("div", { class: "heat-grid" });
    const tooltip = UI.el("div", { class: "heat-tooltip", hidden: true });

    let lastMonth = null;
    let totalCells = 0;

    for (let col = 0; col < COLUMNS; col++) {
      const colDate = DateUtil.addDays(start, col * 7);
      const monthKey = colDate.slice(0, 7);
      const changed = monthKey !== lastMonth && DateUtil.dayNum(colDate) <= 7;
      monthsRow.appendChild(
        UI.el("span", { class: "heat-month", text: changed ? DateUtil.monthShort(colDate) : "" })
      );
      if (changed) lastMonth = monthKey;
    }

    for (let i = 0; i < COLUMNS * ROWS; i++) {
      const date = DateUtil.addDays(start, i);
      totalCells++;
      const future = date > today;
      const progress = future ? null : Gamify.dayProgress(state, date);
      const percent = progress ? progress.percent : 0;
      const cell = UI.el("button", {
        class: "heat-cell" + (future ? " future" : percent > 0 ? " filled" : ""),
        type: "button",
        "data-action": future ? null : "heatmap-day",
        "data-date": date,
        "aria-label": date + " — " + (progress ? progress.done + "/" + progress.total + " habits" : "future"),
        style: future ? "" : "background:" + colorFor(percent),
        tabindex: future ? "-1" : "0",
      });

      if (!future) {
        cell.addEventListener("mouseenter", (ev) => showTip(tooltip, ev, date, progress));
        cell.addEventListener("mousemove", (ev) => moveTip(tooltip, ev));
        cell.addEventListener("mouseleave", () => { tooltip.hidden = true; });
      }
      grid.appendChild(cell);
    }

    const wrap = UI.el("div", { class: "heat-wrap" }, [
      UI.el("div", { class: "heat-scroll" }, [monthsRow, grid]),
    ]);

    container.appendChild(head);
    container.appendChild(wrap);
    container.appendChild(tooltip);
    container.appendChild(
      UI.el("p", { class: "dim small" }, [
        "Click a day to open it. ",
        String(totalCells) + " cells.",
      ])
    );
  }

  function showTip(tooltip, ev, date, progress) {
    tooltip.hidden = false;
    tooltip.textContent = date + " — " + (progress ? progress.done + "/" + progress.total + " habits" : "no habits");
    moveTip(tooltip, ev);
  }

  function moveTip(tooltip, ev) {
    const pad = 14;
    tooltip.style.left = ev.clientX + pad + "px";
    tooltip.style.top = ev.clientY + pad + "px";
  }

  return { render, colorFor, COLORS };
})();
