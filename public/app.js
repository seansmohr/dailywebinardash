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
  document.getElementById("start").value = fmtDate(start);
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
      `${m.contactsFetched} contacts, ${m.appointmentsFetched} appts · ` +
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

function renderCards(totals) {
  const cards = document.getElementById("cards");
  const build = (lp, cls) => {
    const t = totals[lp];
    return `
      <div class="card ${cls}">
        <h2><span class="dot"></span>${escapeHtml(LABELS[lp])}</h2>
        <div class="value-code">${lp === "control" ? "medicare101_landing_page_b" : "medicare101_landing_page_daily"}</div>
        <div class="metrics">
          <div class="metric"><div class="n">${t.contacts}</div><div class="l">Contacts</div></div>
          <div class="metric"><div class="n">${t.attended}</div><div class="l">Attended</div><div class="r">${pct(t.attended, t.contacts)} show</div></div>
          <div class="metric"><div class="n">${t.missed}</div><div class="l">Missed</div><div class="r">${pct(t.missed, t.contacts)}</div></div>
          <div class="metric"><div class="n">${t.autobook}</div><div class="l">${escapeHtml(CAL.autobook)}</div></div>
          <div class="metric"><div class="n">${t.va}</div><div class="l">${escapeHtml(CAL.va)}</div></div>
          <div class="metric"><div class="n">${t.autobook + t.va}</div><div class="l">Booked</div><div class="r">${pct(t.autobook + t.va, t.contacts)} of contacts</div></div>
        </div>
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

function renderCharts(daily, totals) {
  const c = COLORS();
  const labels = daily.map((d) => d.date.slice(5)); // MM-DD

  // Chart 1: daily contacts (line, 2 series)
  upsert("chartContacts", "line", {
    labels,
    datasets: [
      series(LABELS.control, daily.map((d) => d.control.contacts), c.control),
      series(LABELS.test, daily.map((d) => d.test.contacts), c.test),
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

function renderTable(daily, totals) {
  const head = `
    <thead>
      <tr>
        <th rowspan="2">Date</th>
        <th colspan="5" class="col-sep grp-b">${escapeHtml(LABELS.control)}</th>
        <th colspan="5" class="col-sep grp-d">${escapeHtml(LABELS.test)}</th>
      </tr>
      <tr>
        <th class="col-sep">Contacts</th><th>Att</th><th>Miss</th><th>AB</th><th>VA</th>
        <th class="col-sep">Contacts</th><th>Att</th><th>Miss</th><th>AB</th><th>VA</th>
      </tr>
    </thead>`;
  const row = (label, b, d, isFoot) => `
    <tr>
      <td>${label}</td>
      <td class="col-sep">${b.contacts}</td><td>${b.attended}</td><td>${b.missed}</td><td>${b.autobook}</td><td>${b.va}</td>
      <td class="col-sep">${d.contacts}</td><td>${d.attended}</td><td>${d.missed}</td><td>${d.autobook}</td><td>${d.va}</td>
    </tr>`;
  const body = daily
    .map((r) => row(r.date, r.control, r.test))
    .join("");
  const foot = `<tfoot>${row("Total", totals.control, totals.test, true)}</tfoot>`;
  document.getElementById("daily").innerHTML =
    head + `<tbody>${body}</tbody>` + foot;
}

function render(data) {
  renderWarnings(data.meta);
  renderCards(data.totals);
  try {
    if (window.Chart) renderCharts(data.daily, data.totals);
  } catch (e) {
    console.error("Chart render failed:", e);
  }
  renderTable(data.daily, data.totals);

  const m = data.meta;
  const note = [];
  if (m.fieldResolved) {
    note.push(
      `Landing page field: "${m.fieldResolved.name || m.fieldResolved.fieldKey}" (id ${m.fieldResolved.id}).`
    );
  }
  note.push(
    `Contacts bucketed by created date; appointments by appointment date. "Other" (contacts with no landing-page value) is excluded from the two cards but visible in totals via the API.`
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

setDefaultRange(14);
document.querySelector('.preset[data-days="14"]').classList.add("active");
loadConfig().then(() => load(false));
