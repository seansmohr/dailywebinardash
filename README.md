# Daily Webinar Split-Test Dashboard

A live dashboard for the Medicare101 landing-page split test. It pulls real-time
data from **GoHighLevel (GHL)** and compares the two landing pages:

- `medicare101_landing_page_b` — the **control** (Landing Page B)
- `medicare101_landing_page_daily` — the **test** (Daily)

For each landing page, per day, it shows:

- **Contacts** — new registrations
- **Attended** / **Missed** — webinar outcome (from GHL tags)
- **Autobook** / **VA Calendar** appointments booked (from two GHL calendars)

The goal is to tell whether moving to daily webinars is worth it: are the daily
landing page's contacts, show rate, and booking rate better than the control?

---

## How it maps to your GHL data (verified against the live account)

| Metric | Source in GHL |
| --- | --- |
| Landing page | Contact custom field **"Landing Page"** (`contact.landing_page`, id `fTDU51m5BZslEG63pdfN`) = `medicare101_landing_page_b` or `medicare101_landing_page_daily` |
| Attended / Missed | Tags **`attended webinar`** / **`missed webinar`** on the contact |
| Autobook appts | Bookings on the **"Turning 65 Medicare Call"** calendar (`jDfKPflpQai5OB0v7m0C`) |
| VA appts | Bookings on the **"VA Calendar"** (`iDBM1sRSqiZBWhblcGPD`) |

These are baked in as defaults, so the **only** variable you must set is
`GHL_API_TOKEN`. Everything else is overridable via env vars (see `.env.example`)
if the setup changes.

### Cohort model (important)

Every contact is cohorted by its **registration day** (`dateAdded`, in
`DASHBOARD_TZ`). For each landing page, per day:

- **Contacts** — registrations that day
- **Attended / Missed** — of those contacts, how many later earned the tag
- **Autobook / VA** — of those contacts, how many booked on that calendar
  (distinct contacts; `cancelled` appointments excluded)

Because it's a funnel by acquisition day, the **most recent days will show low
attendance/bookings** — those webinars and appointments simply haven't happened
yet. That's expected; look at days old enough for the funnel to complete.

---

## 1. Create a GHL Private Integration token

1. In the GHL sub-account: **Settings → Private Integrations → Create**.
2. Grant these read-only scopes:
   - `View Contacts` (`contacts.readonly`)
   - `View Custom Fields` (`locations/customFields.readonly`)
   - `View Calendars` (`calendars.readonly`)
   - `View Calendar Events` (`calendars/events.readonly`)
3. Copy the token (starts with `pit-…`). That's the **only** value you must set.

The field id, calendar ids, tag names, and location id are already baked in as
verified defaults — override any of them via env var only if the setup changes.

## 2. (Optional) Re-discover config if the GHL setup changes

If you rename a tag, add a calendar, or change the landing-page field, run the
discovery tool to get an updated, ready-to-paste env block:

```bash
npm run discover
```

It lists every custom field and calendar, samples recent contacts to show which
field holds the `medicare101_landing_page_*` values and which tags are in use,
and suggests the env vars. It prints **no PII** — only ids, value strings, tag
names, and counts.

## 3. Deploy on Railway

1. In Railway: **New Project → Deploy from GitHub repo** → pick this repo, and
   set the deploy branch (or merge to `main` first).
2. Under **Variables**, add `GHL_API_TOKEN` (and `DASHBOARD_PASSWORD` if you want
   login protection — recommended, since the dashboard shows lead data). Railway
   provides `PORT` automatically.
3. Deploy. Railway uses `railway.json` (Nixpacks, `npm start`, health check at
   `/healthz`).
4. **Settings → Networking → Generate Domain**, then open the URL.
5. Verify at `/healthz` — `missingEnv` should be `[]`.

## 4. Run locally

```bash
cp .env.example .env      # fill in your values
npm install
# load .env into the shell (or use a tool like dotenv-cli), then:
npm start
# open http://localhost:3000
```

On macOS/Linux you can load the env file inline:

```bash
export $(grep -v '^#' .env | xargs) && npm start
```

---

## API

- `GET /api/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD` — aggregated metrics.
  Add `&refresh=1` to bypass the short cache and force a fresh GHL pull.
- `GET /api/config` — labels + timezone the UI reads on load.
- `GET /healthz` — health check (also reports any missing required env vars).

The response includes per-day rows and totals split into `control`, `test`, and
`other` (contacts with no recognized landing-page value). The UI shows control
and test; `other` is available in the raw API for auditing.

---

## Notes & assumptions

- **Real-time with light caching:** each unique date range is cached for
  `CACHE_TTL_MS` (default 60s) so rapid refreshes don't hammer the GHL API. The
  **↻ Refresh** button bypasses the cache.
- **Attendance is exclusive:** if a contact somehow has both an attended and a
  missed tag, attended wins.
- **Appointment attribution:** each appointment is attributed to its contact's
  landing page. Appointments whose contact registered outside the selected
  window are still counted (the contact is looked up on demand).
- **Timezone:** all day bucketing uses `DASHBOARD_TZ`. Set it to your business
  timezone so "per day" lines up with how you think about the days.
