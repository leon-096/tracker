/* ui.js — DOM helpers, date utilities (Asia/Dhaka), toasts, modals, icons. */
window.DateUtil = (function () {
  "use strict";
  const TZ = (window.TRACKER_CONFIG && window.TRACKER_CONFIG.TIMEZONE) || "Asia/Dhaka";
  const pad = (n) => String(n).padStart(2, "0");
  let dayFmt = null;

  function dayFormatter() {
    if (!dayFmt) {
      dayFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      });
    }
    return dayFmt;
  }

  function key(dateObj) {
    const parts = dayFormatter().formatToParts(dateObj);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  function today() {
    return key(new Date());
  }

  function fromISO(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return today();
    return key(d);
  }

  function parse(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  }

  function toKey(d) {
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function addDays(dateStr, n) {
    const d = parse(dateStr);
    d.setUTCDate(d.getUTCDate() + n);
    return toKey(d);
  }

  function addMonths(dateStr, n) {
    const d = parse(dateStr);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    return toKey(d);
  }

  function diffDays(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  function dow(dateStr) {
    return parse(dateStr).getUTCDay(); // 0 = Sunday
  }

  function startOfWeek(dateStr) {
    return addDays(dateStr, -((dow(dateStr) + 6) % 7)); // Monday
  }

  function startOfMonth(dateStr) {
    return String(dateStr).slice(0, 8) + "01";
  }

  function endOfMonth(dateStr) {
    const d = parse(dateStr);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return toKey(d);
  }

  function daysBetweenList(startStr, endStr) {
    const out = [];
    let cursor = startStr;
    let guard = 0;
    while (cursor <= endStr && guard++ < 400) {
      out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function monthShort(dateStr) {
    return MONTHS[parse(dateStr).getUTCMonth()];
  }

  function dayNum(dateStr) {
    return parse(dateStr).getUTCDate();
  }

  function label(dateStr) {
    return monthShort(dateStr) + " " + dayNum(dateStr);
  }

  function longLabel(dateStr) {
    const d = parse(dateStr);
    return WEEKDAYS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }

  function monthLabel(dateStr) {
    return MONTHS[parse(dateStr).getUTCMonth()] + " " + parse(dateStr).getUTCFullYear();
  }

  function weekdayShort(dateStr) {
    return WEEKDAYS[dow(dateStr)];
  }

  function clockNow() {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date());
    } catch (e) {
      return new Date().toTimeString().slice(0, 8);
    }
  }

  return {
    TZ, today, fromISO, parse, toKey, addDays, addMonths, diffDays, dow,
    startOfWeek, startOfMonth, endOfMonth, daysBetweenList,
    monthShort, dayNum, label, longLabel, monthLabel, weekdayShort, clockNow,
  };
})();

window.UI = (function () {
  "use strict";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (k === "style") node.setAttribute("style", v);
        else if (k === "value") node.value = v;
        else if (k === "checked") node.checked = !!v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  const ICONS = {
    footprint:
      '<ellipse cx="9" cy="7.5" rx="2.6" ry="3.6"/><ellipse cx="15.5" cy="9" rx="2.2" ry="3"/><path d="M6.5 14.5c0 2.4 1.3 4.5 3.2 4.5s2.8-2.1 2.8-4.5"/><circle cx="16.5" cy="14.5" r="2.4"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2"/>',
    code: '<polyline points="8 6 3 12 8 18"/><polyline points="16 6 21 12 16 18"/><line x1="13" y1="4" x2="11" y2="20"/>',
    chess:
      '<circle cx="12" cy="6" r="2.4"/><path d="M9.5 10h5l1 5h-7Z"/><path d="M7 18h10"/><path d="M8 15h8"/>',
    drop: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"/>',
    guitar:
      '<circle cx="9" cy="15" r="4.2"/><circle cx="9" cy="15" r="1.2"/><path d="M12 12 20 4"/><path d="M17 5l2 2"/><path d="M15.5 8.5 17 10"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"/>',
    bolt: '<polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2"/>',
    shield:
      '<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6l7-3Z"/><path d="M9 11.5l2 2 4-4"/>',
    trophy:
      '<path d="M8 4h8v4a4 4 0 0 1-8 0Z"/><path d="M8 5H5v1a3 3 0 0 0 3 3"/><path d="M16 5h3v1a3 3 0 0 1-3 3"/><path d="M12 12v4"/><path d="M9 20h6"/><path d="M10 16h4l1 4H9Z"/>',
    check: '<polyline points="4 12 9 17 20 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16Z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
    up: '<polyline points="6 14 12 8 18 14"/>',
    down: '<polyline points="6 10 12 16 18 10"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    download: '<path d="M12 4v10"/><polyline points="7 10 12 15 17 10"/><path d="M4 19h16"/>',
    upload: '<path d="M12 16V5"/><polyline points="7 10 12 5 17 10"/><path d="M4 20h16"/>',
  };

  function icon(name, size) {
    const body = ICONS[name] || ICONS.check;
    return (
      '<svg class="ic" viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + "</svg>"
    );
  }

  function toast(message, kind, ms) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const node = el("div", { class: "toast toast-" + (kind || "info") });
    node.textContent = message;
    root.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 260);
    }, ms || 1500);
  }

  let closeModalFn = null;

  function closeModal() {
    const root = document.getElementById("modal-root");
    if (!root) return;
    root.hidden = true;
    clear(root);
    closeModalFn = null;
  }

  function openModal(opts) {
    const root = document.getElementById("modal-root");
    if (!root) return;
    clear(root);
    root.hidden = false;

    const close = () => closeModal();
    const box = el("div", { class: "modal" + (opts.wide ? " modal-wide" : ""), role: "dialog", "aria-modal": "true" });

    const head = el("div", { class: "modal-head" }, [
      el("div", { class: "modal-title", text: "> " + (opts.title || "") }),
      el("button", { class: "icon-btn", type: "button", "aria-label": "Close", html: icon("close"), onclick: close }),
    ]);
    box.appendChild(head);

    const bodyWrap = el("div", { class: "modal-body" });
    if (typeof opts.body === "string") bodyWrap.innerHTML = opts.body;
    else if (opts.body) bodyWrap.appendChild(opts.body);
    box.appendChild(bodyWrap);

    if (opts.actions && opts.actions.length) {
      const foot = el("div", { class: "modal-foot" });
      for (const action of opts.actions) {
        foot.appendChild(
          el("button", {
            class: "btn " + (action.kind || "ghost"),
            type: "button",
            text: action.label,
            onclick: () => action.onClick && action.onClick(close),
          })
        );
      }
      box.appendChild(foot);
    }

    root.appendChild(box);
    closeModalFn = close;

    const backdrop = (ev) => {
      if (ev.target === root) close();
    };
    root.onclick = backdrop;
    document.addEventListener("keydown", escOnce);
    if (opts.onMount) opts.onMount(box, close);
    return close;
  }

  function escOnce(ev) {
    if (ev.key === "Escape") {
      document.removeEventListener("keydown", escOnce);
      closeModal();
    }
  }

  function ring(percent, centerBig, centerSmall) {
    const r = 42;
    const circumference = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, percent || 0));
    const offset = circumference * (1 - pct / 100);
    const wrap = el("div", { class: "ring" });
    wrap.innerHTML =
      '<svg viewBox="0 0 100 100" width="120" height="120" aria-hidden="true">' +
      '<circle class="ring-track" cx="50" cy="50" r="' + r + '"/>' +
      '<circle class="ring-fill" cx="50" cy="50" r="' + r + '" stroke-dasharray="' +
      circumference.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
      "</svg>" +
      '<div class="ring-text"><div class="ring-big">' + (centerBig || "0%") + "</div>" +
      '<div class="ring-small">' + (centerSmall || "") + "</div></div>";
    return wrap;
  }

  function sparkline(series) {
    const wrap = el("div", { class: "sparkline", title: "Completion, last 7 days" });
    for (const item of series) {
      wrap.appendChild(
        el("span", {
          class: "spark-bar" + (item.percent > 0 ? " filled" : ""),
          style: "height:" + Math.max(2, item.percent) + "%;opacity:" + (0.35 + item.percent / 150).toFixed(2),
          title: item.date + " — " + item.done + "/" + item.total,
        })
      );
    }
    return wrap;
  }

  function spinner(text) {
    return el("div", { class: "loading" }, [
      el("span", { class: "loading-dots", text: "> " + (text || "working") }),
    ]);
  }

  return { el, clear, icon, toast, openModal, closeModal, ring, sparkline, spinner };
})();
