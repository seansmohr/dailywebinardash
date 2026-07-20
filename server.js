import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, assertConfigured } from "./src/config.js";
import { buildDashboard } from "./src/aggregate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");

// ---- optional HTTP Basic Auth ----
if (config.auth.password) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, pass] = Buffer.from(encoded, "base64")
        .toString("utf8")
        .split(":");
      const okUser = !config.auth.user || user === config.auth.user;
      if (okUser && pass === config.auth.password) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Daily Webinar Dashboard"');
    return res.status(401).send("Authentication required.");
  });
}

// ---- tiny in-memory cache (real-time, but shields GHL from refresh spam) ----
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 60_000);
const cache = new Map(); // key -> { ts, data }

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, missingEnv: assertConfigured() });
});

app.get("/api/config", (_req, res) => {
  res.json({
    landingPages: config.landingPages,
    calendars: {
      autobook: { label: config.calendars.autobook.label },
      va: { label: config.calendars.va.label },
    },
    timezone: config.timezone,
    missingEnv: assertConfigured(),
  });
});

app.get("/api/dashboard", async (req, res) => {
  const missing = assertConfigured();
  if (missing.length) {
    return res.status(500).json({
      error: `Missing required environment variables: ${missing.join(", ")}`,
    });
  }

  // Default window: last 14 days through end of today, in the dashboard tz.
  const now = new Date();
  const end = req.query.end
    ? `${req.query.end}T23:59:59.999Z`
    : endOfDayISO(now);
  const start = req.query.start
    ? `${req.query.start}T00:00:00.000Z`
    : startOfDayISO(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000));

  const key = `${start}|${end}`;
  const force = req.query.refresh === "1";
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return res.json({ ...hit.data, meta: { ...hit.data.meta, cached: true } });
  }

  try {
    const data = await buildDashboard(start, end);
    cache.set(key, { ts: Date.now(), data });
    res.json({ ...data, meta: { ...data.meta, cached: false } });
  } catch (err) {
    console.error("Dashboard build failed:", err);
    res.status(502).json({
      error: err.message || "Failed to build dashboard from GHL.",
      status: err.status,
      details: err.body || null,
    });
  }
});

// Serve Chart.js from the installed dependency (no CDN dependency at runtime).
app.get("/vendor/chart.umd.js", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "node_modules", "chart.js", "dist", "chart.umd.js")
  );
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(config.port, () => {
  const missing = assertConfigured();
  console.log(`Daily Webinar Dashboard listening on :${config.port}`);
  if (missing.length) {
    console.warn(
      `WARNING: missing env vars ${missing.join(", ")} — /api/dashboard will error until set.`
    );
  }
});

function startOfDayISO(d) {
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}
function endOfDayISO(d) {
  return `${d.toISOString().slice(0, 10)}T23:59:59.999Z`;
}
