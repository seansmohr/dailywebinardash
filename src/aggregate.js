// Aggregation logic: turn raw GHL contacts + appointments into per-day,
// per-landing-page split-test metrics.
import { config } from "./config.js";
import {
  resolveCustomField,
  searchContactsByDateAdded,
  getCalendarEvents,
  getContact,
} from "./ghl.js";

// ---- small helpers ----

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

// Return YYYY-MM-DD in the dashboard timezone for any date-ish input.
function dayKey(input) {
  const d = toDate(input);
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function toDate(input) {
  if (input == null) return null;
  if (input instanceof Date) return input;
  // Numeric (or numeric string) => epoch milliseconds.
  if (typeof input === "number") return new Date(input);
  if (/^\d{10,}$/.test(String(input).trim())) return new Date(Number(input));
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function emptyBucket() {
  return { contacts: 0, attended: 0, missed: 0, autobook: 0, va: 0 };
}

// Which landing page a contact belongs to: "control" | "test" | "other".
function landingPageOf(contact, fieldId) {
  const fields = contact.customFields || contact.custom_fields || [];
  let raw = null;
  for (const f of fields) {
    const fid = f.id || f.customFieldId || f.field;
    if (fid && fid === fieldId) {
      raw = f.value ?? f.field_value ?? f.fieldValue;
      break;
    }
  }
  const v = norm(raw);
  if (!v) return "other";
  if (v === norm(config.landingPages.control.value)) return "control";
  if (v === norm(config.landingPages.test.value)) return "test";
  return "other";
}

// Attendance from tags: "attended" | "missed" | null. Attended wins ties.
function attendanceOf(contact) {
  const tags = (contact.tags || []).map(norm);
  const attendedSet = config.tags.attended.map(norm);
  const missedSet = config.tags.missed.map(norm);
  if (tags.some((t) => attendedSet.includes(t))) return "attended";
  if (tags.some((t) => missedSet.includes(t))) return "missed";
  return null;
}

// Build the inclusive list of YYYY-MM-DD day keys spanning [start, end].
function dayRange(startISO, endISO) {
  const days = [];
  const start = dayKey(startISO);
  const end = dayKey(endISO);
  // Iterate by walking the UTC date and formatting into local tz. Step 12h to
  // be safe across DST boundaries, dedupe by key.
  let cursor = toDate(startISO);
  const endDate = toDate(endISO);
  const seen = new Set();
  while (cursor <= endDate) {
    const k = dayKey(cursor);
    if (k && !seen.has(k)) {
      seen.add(k);
      days.push(k);
    }
    cursor = new Date(cursor.getTime() + 12 * 60 * 60 * 1000);
  }
  // Guarantee endpoints are present.
  if (start && !seen.has(start)) days.unshift(start);
  if (end && !seen.has(end)) days.push(end);
  return [...new Set(days)].sort();
}

// ---- main aggregation ----

export async function buildDashboard(startISO, endISO) {
  // 1. Resolve the landing-page custom field id.
  const field = await resolveCustomField(config.lpFieldKey);
  const fieldId = field?.id || null;

  // 2. Pull all contacts registered in the window.
  const contacts = await searchContactsByDateAdded(startISO, endISO);

  // Prepare per-day buckets, seeded with zeros for every day in range.
  const days = dayRange(startISO, endISO);
  const daily = new Map(); // dayKey -> { control, test, other }
  for (const d of days) {
    daily.set(d, {
      control: emptyBucket(),
      test: emptyBucket(),
      other: emptyBucket(),
    });
  }
  function bucketFor(dayK, lp) {
    if (!daily.has(dayK)) {
      daily.set(dayK, {
        control: emptyBucket(),
        test: emptyBucket(),
        other: emptyBucket(),
      });
    }
    return daily.get(dayK)[lp];
  }

  // Map contactId -> landing page, for appointment attribution.
  const contactLp = new Map();

  // 3. Fold contacts into daily buckets (contacts / attended / missed).
  for (const c of contacts) {
    const lp = landingPageOf(c, fieldId);
    if (c.id) contactLp.set(c.id, lp);
    const dk = dayKey(c.dateAdded || c.dateCreated || c.createdAt);
    if (!dk) continue;
    const b = bucketFor(dk, lp);
    b.contacts += 1;
    const att = attendanceOf(c);
    if (att === "attended") b.attended += 1;
    else if (att === "missed") b.missed += 1;
  }

  // 4. Pull appointments for each calendar, attribute to landing page + day.
  const startMs = toDate(startISO).getTime();
  const endMs = toDate(endISO).getTime();
  const calendarJobs = [
    { key: "autobook", id: config.calendars.autobook.id },
    { key: "va", id: config.calendars.va.id },
  ];

  const unknownContactIds = new Set();
  const apptRecords = [];
  for (const job of calendarJobs) {
    if (!job.id) continue;
    const events = await getCalendarEvents(job.id, startMs, endMs);
    for (const ev of events) {
      const cid = ev.contactId || ev.contact?.id;
      const dk = dayKey(ev.startTime || ev.dateAdded || ev.createdAt);
      apptRecords.push({ kind: job.key, contactId: cid, day: dk });
      if (cid && !contactLp.has(cid)) unknownContactIds.add(cid);
    }
  }

  // Resolve landing page for appointment owners not seen in the contact pull
  // (e.g. contacts registered outside the window who booked inside it).
  for (const cid of unknownContactIds) {
    const c = await getContact(cid);
    contactLp.set(cid, c ? landingPageOf(c, fieldId) : "other");
  }

  for (const rec of apptRecords) {
    if (!rec.day) continue;
    const lp = rec.contactId ? contactLp.get(rec.contactId) || "other" : "other";
    const b = bucketFor(rec.day, lp);
    if (rec.kind === "autobook") b.autobook += 1;
    else if (rec.kind === "va") b.va += 1;
  }

  // 5. Assemble sorted daily rows + totals.
  const sortedDays = [...daily.keys()].sort();
  const dailyRows = sortedDays.map((date) => ({ date, ...daily.get(date) }));

  const totals = {
    control: emptyBucket(),
    test: emptyBucket(),
    other: emptyBucket(),
  };
  for (const row of dailyRows) {
    for (const lp of ["control", "test", "other"]) {
      for (const k of Object.keys(totals[lp])) {
        totals[lp][k] += row[lp][k];
      }
    }
  }

  return {
    meta: {
      start: startISO,
      end: endISO,
      timezone: config.timezone,
      generatedAt: new Date().toISOString(),
      fieldResolved: field
        ? { id: field.id, fieldKey: field.fieldKey, name: field.name }
        : null,
      lpFieldKeyRequested: config.lpFieldKey,
      landingPages: {
        control: config.landingPages.control,
        test: config.landingPages.test,
      },
      calendars: {
        autobook: config.calendars.autobook,
        va: config.calendars.va,
      },
      tags: config.tags,
      contactsFetched: contacts.length,
      appointmentsFetched: apptRecords.length,
      warnings: buildWarnings(field),
    },
    totals,
    daily: dailyRows,
  };
}

function buildWarnings(field) {
  const warnings = [];
  if (!field) {
    warnings.push(
      `Landing page custom field "${config.lpFieldKey}" could not be resolved in GHL. Every contact will fall under "other". Check GHL_LP_FIELD_KEY.`
    );
  }
  if (!config.calendars.autobook.id) {
    warnings.push("CALENDAR_AUTOBOOK_ID is not set — autobook counts will be 0.");
  }
  if (!config.calendars.va.id) {
    warnings.push("CALENDAR_VA_ID is not set — VA calendar counts will be 0.");
  }
  return warnings;
}
