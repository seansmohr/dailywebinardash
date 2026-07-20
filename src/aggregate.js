// Aggregation logic for the landing-page split test.
//
// Model: every contact is cohorted by the day it REGISTERED (dateAdded), in the
// dashboard timezone. For each landing page, per registration day, we report:
//   contacts  – new registrations
//   attended  – contacts with an "attended webinar" tag
//   missed    – contacts with a "missed webinar" tag
//   autobook  – contacts who booked on the autobook (Turning 65) calendar
//   va        – contacts who booked on the VA calendar
// "Booked" counts DISTINCT CONTACTS who scheduled (cancelled/deleted excluded),
// which matches "contacts who schedule an appointment".
import { config } from "./config.js";
import {
  resolveCustomField,
  searchContactsByDateAdded,
  customFieldFilter,
  getCalendarEvents,
} from "./ghl.js";

// ---- helpers ----

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function toDate(input) {
  if (input == null) return null;
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (/^\d{10,}$/.test(String(input).trim())) return new Date(Number(input));
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

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

function emptyBucket() {
  return { contacts: 0, attended: 0, missed: 0, autobook: 0, va: 0 };
}

function attendanceOf(contact) {
  const tags = (contact.tags || []).map(norm);
  const attendedSet = config.tags.attended.map(norm);
  const missedSet = config.tags.missed.map(norm);
  if (tags.some((t) => attendedSet.includes(t))) return "attended";
  if (tags.some((t) => missedSet.includes(t))) return "missed";
  return null;
}

function lpValueOf(contact, fieldId) {
  const fields = contact.customFields || contact.custom_fields || [];
  for (const f of fields) {
    const fid = f.id || f.customFieldId || f.field;
    if (fid && fid === fieldId) return f.value ?? f.field_value ?? f.fieldValue;
  }
  return null;
}

function classify(value) {
  const v = norm(value);
  if (v === norm(config.landingPages.control.value)) return "control";
  if (v === norm(config.landingPages.test.value)) return "test";
  return "other";
}

function dayRange(startISO, endISO) {
  const days = [];
  const seen = new Set();
  let cursor = toDate(startISO);
  const endDate = toDate(endISO);
  while (cursor <= endDate) {
    const k = dayKey(cursor);
    if (k && !seen.has(k)) {
      seen.add(k);
      days.push(k);
    }
    cursor = new Date(cursor.getTime() + 12 * 60 * 60 * 1000);
  }
  const endK = dayKey(endISO);
  if (endK && !seen.has(endK)) days.push(endK);
  return [...new Set(days)].sort();
}

// ---- main ----

export async function buildDashboard(startISO, endISO) {
  // 1. Resolve the landing-page custom field id.
  const field = await resolveCustomField(config.lpFieldKey);
  const fieldId = field?.id || null;

  // 2. Fetch the two cohorts (registered in-window). If the field resolved, we
  //    filter server-side per landing page; otherwise fetch all and classify.
  let contacts = []; // { contact, lp }
  if (fieldId) {
    const [control, test] = await Promise.all([
      searchContactsByDateAdded(startISO, endISO, [
        customFieldFilter(fieldId, config.landingPages.control.value),
      ]),
      searchContactsByDateAdded(startISO, endISO, [
        customFieldFilter(fieldId, config.landingPages.test.value),
      ]),
    ]);
    contacts = [
      ...control.map((c) => ({ contact: c, lp: "control" })),
      ...test.map((c) => ({ contact: c, lp: "test" })),
    ];
  } else {
    const all = await searchContactsByDateAdded(startISO, endISO);
    contacts = all.map((c) => ({
      contact: c,
      lp: classify(lpValueOf(c, fieldId)),
    }));
  }

  // Map contactId -> { lp, day } for appointment attribution.
  const cohort = new Map();
  for (const { contact, lp } of contacts) {
    if (!contact.id) continue;
    cohort.set(contact.id, { lp, day: dayKey(contact.dateAdded) });
  }

  // 3. Appointments: pull events for both calendars from window start into the
  //    future (a window contact may book an appointment scheduled later), then
  //    keep only bookings whose contact is in our cohort.
  const startMs = toDate(startISO).getTime();
  const farMs = Date.now() + 180 * 24 * 60 * 60 * 1000;
  const excluded = config.apptExcludeStatuses.map(norm);
  const booked = new Map(); // contactId -> Set('autobook'|'va')
  let apptConsidered = 0;

  const calJobs = [
    { key: "autobook", id: config.calendars.autobook.id },
    { key: "va", id: config.calendars.va.id },
  ];
  for (const job of calJobs) {
    if (!job.id) continue;
    const events = await getCalendarEvents(job.id, startMs, farMs);
    for (const ev of events) {
      if (ev.deleted) continue;
      const status = norm(ev.appointmentStatus || ev.appoinmentStatus);
      if (status && excluded.includes(status)) continue;
      const cid = ev.contactId || ev.contact?.id;
      if (!cid || !cohort.has(cid)) continue;
      apptConsidered += 1;
      if (!booked.has(cid)) booked.set(cid, new Set());
      booked.get(cid).add(job.key);
    }
  }

  // 4. Aggregate per registration day.
  const days = dayRange(startISO, endISO);
  const daily = new Map();
  const ensure = (d) => {
    if (!daily.has(d))
      daily.set(d, { control: emptyBucket(), test: emptyBucket() });
    return daily.get(d);
  };
  for (const d of days) ensure(d);

  for (const { contact, lp } of contacts) {
    if (lp === "other") continue;
    const d = dayKey(contact.dateAdded);
    if (!d) continue;
    const b = ensure(d)[lp];
    b.contacts += 1;
    const att = attendanceOf(contact);
    if (att === "attended") b.attended += 1;
    else if (att === "missed") b.missed += 1;
    const bset = booked.get(contact.id);
    if (bset?.has("autobook")) b.autobook += 1;
    if (bset?.has("va")) b.va += 1;
  }

  const sortedDays = [...daily.keys()].sort();
  const dailyRows = sortedDays.map((date) => ({ date, ...daily.get(date) }));

  const totals = { control: emptyBucket(), test: emptyBucket() };
  for (const row of dailyRows) {
    for (const lp of ["control", "test"]) {
      for (const k of Object.keys(totals[lp])) totals[lp][k] += row[lp][k];
    }
  }

  return {
    meta: {
      start: startISO,
      end: endISO,
      timezone: config.timezone,
      generatedAt: new Date().toISOString(),
      cohortBasis: "registration_day",
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
      apptExcludeStatuses: config.apptExcludeStatuses,
      contactsFetched: contacts.length,
      appointmentsCounted: apptConsidered,
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
      `Landing page custom field "${config.lpFieldKey}" could not be resolved in GHL. Contacts are classified by reading the field id from each record. Check GHL_LP_FIELD_KEY.`
    );
  }
  if (!config.calendars.autobook.id)
    warnings.push("CALENDAR_AUTOBOOK_ID is not set — autobook counts will be 0.");
  if (!config.calendars.va.id)
    warnings.push("CALENDAR_VA_ID is not set — VA calendar counts will be 0.");
  return warnings;
}
