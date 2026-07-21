// Dashboard client. Fetches /api/dashboard and renders KPI cards, charts, table.

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const COLORS = () => ({
  control: css("--control"),
  test: css("--test"),
  good: css("--good"),
  critical: css("--critical"),
  grid: css("--grid"),
  muted: css("--muted"),
  text: css("--text-secondary"),
});

let LABELS = { control: "Landing Page B (control)", test: "Daily (test)" };
let CAL = { autobook: "Autobook", va: "VA Calendar" };
const charts = {};

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function setDefaultRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  // Snap the start back to its Monday so weeks are whole on the left edge.
  const startStr = isoWeekMonday(fmtDate(start));
  document.getElementById("start").value = startStr;
  document.getElementById("end").value = fmtDate(end);
}

function pct(n, d) {
  if (!d) return "—";
  return Math.round((n / d) * 1000) / 10 + "%";
}

async function loadConfig() {
  try {
    const r = await fetch("/api/config");
    const c = await r.json();
    if (c.landingPages) {
      LABELS.control = c.landingPages.control.label;
      LABELS.test = c.landingPages.test.label;
      document.getElementById("key-control").textContent = LABELS.control;
      document.getElementById("key-test").textContent = LABELS.test;
    }
    if (c.calendars) {
      CAL.autobook = c.calendars.autobook.label;
      CAL.va = c.calendars.va.label;
    }
  } catch (_) {
    /* non-fatal */
  }
}

async function load(refresh = false) {
  const start = document.getElementById("start").value;
  const end = document.getElementById("end").value;
  const status = document.getElementById("status");
  status.className = "status-bar";
  status.textContent = "Loading from GoHighLevel…";

  const params = new URLSearchParams({ start, end });
  if (refresh) params.set("refresh", "1");

  try {
    const r = await fetch(`/api/dashboard?${params.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");
    render(data);
    const m = data.meta;
    status.textContent =
      `Updated ${new Date(m.generatedAt).toLocaleString()} · ` +
      `${m.contactsFetched} contacts, ${m.appointmentsCounted} appts · ` +
      `tz ${m.timezone}${m.cached ? " · cached" : ""}`;
  } catch (err) {
    status.className = "status-bar err";
    status.textContent = "Error: " + err.message;
  }
}

function renderWarnings(meta) {
  const box = document.getElementById("warnings");
  const w = meta.warnings || [];
  if (!w.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML =
    `<div class="warn"><strong>Heads up:</strong><ul>` +
    w.map((x) => `<li>${escapeHtml(x)}</li>`).join("") +
    `</ul></div>`;
}

// Rates are computed against RESOLVED contacts (attended + missed) — i.e. those
// whose webinar has already happened — so the two funnels compare fairly even
// though Daily launched more recently and has many still-pending registrants.
function ratesOf(t) {
  const resolved = t.attended + t.missed;
  const r = (n) => (resolved ? n / resolved : null);
  return { resolved, show: r(t.attended), autobook: r(t.autobook), va: r(t.va) };
}
function pctv(x) {
  return x == null ? "—" : Math.round(x * 1000) / 10 + "%";
}
// Percentage-point delta of test vs control, as a colored chip.
function deltaChip(testVal, ctrlVal) {
  if (testVal == null || ctrlVal == null) return "";
  const dpp = (testVal - ctrlVal) * 100;
  const sign = dpp >= 0 ? "+" : "";
  const cls = dpp >= 0 ? "up" : "down";
  return `<span class="delta ${cls}">${sign}${Math.round(dpp * 10) / 10}pp</span>`;
}

function renderCards(totals) {
  const cards = document.getElementById("cards");
  const cr = ratesOf(totals.control);

  const build = (lp, cls) => {
    const t = totals[lp];
    const r = ratesOf(t);
    const isTest = lp === "test";
    const rateRow = (label, val, cmp) => `
      <div class="rate">
        <div class="rv">${pctv(val)}${isTest ? deltaChip(val, cmp) : ""}</div>
        <div class="rl">${label}</div>
      </div>`;
    return `
      <div class="card ${cls}">
        <h2><span class="dot"></span>${escapeHtml(LABELS[lp])}</h2>
        <div class="value-code">${lp === "control" ? "medicare101_landing_page_b" : "medicare101_landing_page_daily"}</div>
        <div class="metrics">
          <div class="metric"><div class="n">${t.contacts}</div><div class="l">Contacts</div></div>
          <div class="metric"><div class="n">${t.attended}</div><div class="l">Attended</div></div>
          <div class="metric"><div class="n">${t.missed}</div><div class="l">Missed</div></div>
          <div class="metric"><div class="n">${t.autobook}</div><div class="l">${escapeHtml(CAL.autobook)}</div></div>
          <div class="metric"><div class="n">${t.va}</div><div class="l">${escapeHtml(CAL.va)}</div></div>
          <div class="metric"><div class="n">${t.autobook + t.va}</div><div class="l">Booked</div></div>
        </div>
        <div class="rates">
          ${rateRow("Show rate", r.show, cr.show)}
          ${rateRow("Autobook rate", r.autobook, cr.autobook)}
          ${rateRow("VA book rate", r.va, cr.va)}
        </div>
        <div class="rates-note">rates among ${r.resolved} resolved (attended + missed)</div>
      </div>`;
  };
  cards.innerHTML = build("control", "control") + build("test", "test");
}

function baseOpts(extra = {}) {
  const c = COLORS();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: c.text, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
      tooltip: { padding: 10, boxPadding: 4 },
    },
    scales: {
      x: { grid: { color: c.grid }, ticks: { color: c.muted } },
      y: { beginAtZero: true, grid: { color: c.grid }, ticks: { color: c.muted, precision: 0 } },
    },
    ...extra,
  };
}

// ---- weekly rollup (Mon–Sun weeks) ----
function isoWeekMonday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function fmtMD(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} ${d}`;
}
function rollupWeekly(daily) {
  const weeks = new Map(); // monday -> {control, test}
  for (const row of daily) {
    const wk = isoWeekMonday(row.date);
    if (!weeks.has(wk))
      weeks.set(wk, {
        control: { contacts: 0, attended: 0, missed: 0, autobook: 0, va: 0 },
        test: { contacts: 0, attended: 0, missed: 0, autobook: 0, va: 0 },
      });
    const w = weeks.get(wk);
    for (const lp of ["control", "test"])
      for (const k of Object.keys(w[lp])) w[lp][k] += row[lp][k];
  }
  return [...weeks.keys()].sort().map((monday) => ({
    weekStart: monday,
    weekEnd: addDays(monday, 6),
    label: `${fmtMD(monday)}–${fmtMD(addDays(monday, 6))}`,
    ...weeks.get(monday),
  }));
}

function renderCharts(weekly, totals) {
  const c = COLORS();
  const labels = weekly.map((w) => w.label);

  // Chart 1: weekly contacts (line, 2 series)
  upsert("chartContacts", "line", {
    labels,
    datasets: [
      series(LABELS.control, weekly.map((w) => w.control.contacts), c.control),
      series(LABELS.test, weekly.map((w) => w.test.contacts), c.test),
    ],
  }, baseOpts());

  // Chart 2: attendance (grouped bar, x = Attended/Missed, series = landing pages)
  upsert("chartAttendance", "bar", {
    labels: ["Attended", "Missed"],
    datasets: [
      bar(LABELS.control, [totals.control.attended, totals.control.missed], c.control),
      bar(LABELS.test, [totals.test.attended, totals.test.missed], c.test),
    ],
  }, baseOpts());

  // Chart 3: appointments (grouped bar, x = Autobook/VA, series = landing pages)
  upsert("chartAppts", "bar", {
    labels: [CAL.autobook, CAL.va],
    datasets: [
      bar(LABELS.control, [totals.control.autobook, totals.control.va], c.control),
      bar(LABELS.test, [totals.test.autobook, totals.test.va], c.test),
    ],
  }, baseOpts());
}

function series(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    tension: 0.25,
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
  };
}
function bar(label, data, color) {
  return { label, data, backgroundColor: color, borderColor: color, borderRadius: 4, maxBarThickness: 64 };
}

function upsert(id, type, data, options) {
  if (charts[id]) {
    charts[id].data = data;
    charts[id].options = options;
    charts[id].update();
  } else {
    charts[id] = new Chart(document.getElementById(id), { type, data, options });
  }
}

function renderTable(weekly, totals) {
  const head = `
    <thead>
      <tr>
        <th rowspan="2">Week</th>
        <th colspan="5" class="col-sep grp-b">${escapeHtml(LABELS.control)}</th>
        <th colspan="5" class="col-sep grp-d">${escapeHtml(LABELS.test)}</th>
      </tr>
      <tr>
        <th class="col-sep">Contacts</th><th>Att</th><th>Miss</th><th>AB</th><th>VA</th>
        <th class="col-sep">Contacts</th><th>Att</th><th>Miss</th><th>AB</th><th>VA</th>
      </tr>
    </thead>`;
  const row = (label, b, d) => `
    <tr>
      <td>${label}</td>
      <td class="col-sep">${b.contacts}</td><td>${b.attended}</td><td>${b.missed}</td><td>${b.autobook}</td><td>${b.va}</td>
      <td class="col-sep">${d.contacts}</td><td>${d.attended}</td><td>${d.missed}</td><td>${d.autobook}</td><td>${d.va}</td>
    </tr>`;
  const body = weekly.map((w) => row(w.label, w.control, w.test)).join("");
  const foot = `<tfoot>${row("Total", totals.control, totals.test)}</tfoot>`;
  document.getElementById("daily").innerHTML =
    head + `<tbody>${body}</tbody>` + foot;
}

function render(data) {
  renderWarnings(data.meta);
  renderCards(data.totals);
  const weekly = rollupWeekly(data.daily);
  try {
    if (window.Chart) renderCharts(weekly, data.totals);
  } catch (e) {
    console.error("Chart render failed:", e);
  }
  renderTable(weekly, data.totals);

  const m = data.meta;
  const note = [];
  if (m.fieldResolved) {
    note.push(
      `Landing page field: "${m.fieldResolved.name || m.fieldResolved.fieldKey}" (id ${m.fieldResolved.id}).`
    );
  }
  note.push(
    `Grouped into Mon–Sun weeks. Within each week, contacts count on their signup day, attended/missed on the WEBINAR day (webinar-date field + tags), and autobook/VA on the day booked (cancelled excluded). Show rate, autobook rate, and VA book rate are computed among RESOLVED contacts across the range (attended + missed) so the two funnels compare fairly. Green/red chips on Daily show the percentage-point gap vs the control.`
  );
  document.getElementById("footnote").textContent = note.join(" ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

// ---- wire up ----
document.getElementById("apply").addEventListener("click", () => load(false));
document.getElementById("refresh").addEventListener("click", () => load(true));
document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    setDefaultRange(Number(btn.dataset.days));
    load(false);
  });
});
// Re-render charts on theme change so colors track light/dark.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    document.getElementById("apply").click();
  });
}

setDefaultRange(28);
document.querySelector('.preset[data-days="28"]').classList.add("active");
loadConfig().then(() => load(false));
