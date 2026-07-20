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

## How it maps to your GHL data

| Metric | Source in GHL |
| --- | --- |
| Landing page | A **contact custom field** (`GHL_LP_FIELD_KEY`) whose value is `medicare101_landing_page_b` or `medicare101_landing_page_daily` |
| Attended / Missed | **Tags** on the contact (`TAG_ATTENDED`, `TAG_MISSED`) |
| Autobook appts | Events on the **autobook calendar** (`CALENDAR_AUTOBOOK_ID`) |
| VA appts | Events on the **VA calendar** (`CALENDAR_VA_ID`) |
| Day bucketing | Contacts by created date, appointments by appointment date, in `DASHBOARD_TZ` |

Nothing is hard-coded — every field key, tag, calendar, and label is an env var,
so you can retune it without touching code.

---

## 1. Create a GHL Private Integration token

1. In the GHL sub-account: **Settings → Private Integrations → Create**.
2. Grant these scopes (read-only is enough):
   - `View Contacts` (`contacts.readonly`)
   - `View Custom Fields` (`locations/customFields.readonly`)
   - `View Calendar Events` (`calendars/events.readonly`)
3. Copy the token (starts with `pit-…`) into `GHL_API_TOKEN`.
4. Find your **Location ID** (Settings → Business Profile, or the URL) → `GHL_LOCATION_ID`.

## 2. Find the field key, tags, and calendar IDs

- **Custom field:** Settings → Custom Fields. Use the field name or key that
  stores the landing page value. Set `GHL_LP_FIELD_KEY` to it (the app resolves
  the field id for you at request time).
- **Tags:** whatever your webinar automation applies for attended vs missed.
- **Calendar IDs:** Calendars → each calendar's settings; the id is in the URL.

## 2b. (Recommended) Auto-discover your config

Instead of hunting for field keys, calendar IDs, and tag names by hand, run the
discovery tool. With `GHL_API_TOKEN` + `GHL_LOCATION_ID` set, it inspects your
account and prints a ready-to-paste env block:

```bash
npm run discover
```

It lists every custom field and calendar, samples the last 30 days of contacts
to show which field actually holds the `medicare101_landing_page_*` values and
which tags are in use, and suggests `GHL_LP_FIELD_KEY`, `CALENDAR_AUTOBOOK_ID`,
and `CALENDAR_VA_ID`. It prints **no PII** — only field ids, value strings, tag
names, and counts.

## 3. Deploy on Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** → pick this repo.
3. Add the environment variables from `.env.example` under the service's
   **Variables** tab. Railway provides `PORT` automatically.
4. Deploy. Railway uses `railway.json` (Nixpacks, `npm start`, health check at
   `/healthz`).
5. Open the generated URL. Set `DASHBOARD_PASSWORD` first if you want it private.

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
