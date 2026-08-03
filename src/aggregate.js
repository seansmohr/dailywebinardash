// Aggregation for the landing-page split test — EVENT-DAY model.
//
// Each metric is counted on the day it actually happened:
//   contacts          – the day the contact registered (dateAdded)
//   attended / missed  – the day the WEBINAR ran (webinar-date custom field)
//   autobook / va      – the day the appointment was BOOKED (event.dateAdded)
//
// Because attendance and bookings happen days after signup, we pull contacts
// from `lookbackDays` before the window so those in-window events are complete.
import { config } from "./config.js";
import {
  resolveCustomField,
  searchContactsByDateAdded,
  customFieldFilter,
  getCalendarEvents,
  getContact,
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

// Day key for a precise timestamp (registration, booking), in the dashboard tz.
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

// Day key for a DATE-ONLY custom field (e.g. webinar date "2026-07-21T00:00:00Z").
// These represent a calendar date stored at midnight UTC, so take the date part
// verbatim — tz-converting would wrongly shift it to the previous day.
function plainDateKey(value) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return dayKey(s); // fallback for unexpected formats
}

function emptyBucket() {
  return { contacts: 0, attended: 0, missed: 0, autobook: 0, va: 0 };
}

function readField(contact, fieldId) {
  if (!fieldId) return null;
  const fields = contact.customFields || contact.custom_fields || [];
  for (const f of fields) {
    const fid = f.id || f.customFieldId || f.field;
    if (fid && fid === fieldId) return f.value ?? f.field_value ?? f.fieldValue;
  }
  return null;
}

const ATTENDED_TAGS = config.tags.attended.map(norm);
const MISSED_TAGS = config.tags.missed.map(norm);

// Attendance for the webinar scheduled on `webDay` (the contact's webinar-date).
// The attended/missed tags are STICKY across a contact's lifetime, so for a
// repeat registrant they can reflect an EARLIER webinar. GHL's API returns tag
// names without the timestamp they were applied, so to "go off the most recent"
// webinar we use the "Date - Webinar Watched" field — the authoritative
// per-event signal for the latest webinar the contact actually watched. A
// contact counts as attended for THIS webinar only if they watched on this day;
// otherwise, if they carry any resolution tag, they missed this one.
export function attendanceOn(contact, webDay, watchedFieldId) {
  const tags = (contact.tags || []).map(norm);
  const hasAttended = tags.some((t) => ATTENDED_TAGS.includes(t));
  const hasMissed = tags.some((t) => MISSED_TAGS.includes(t));
  if (!hasAttended && !hasMissed) return null; // not resolved yet

  const watchedRaw = watchedFieldId ? readField(contact, watchedFieldId) : null;
  const watchedDay = watchedRaw ? plainDateKey(watchedRaw) : null;

  // Actually watched this webinar → attended.
  if (watchedDay && watchedDay === webDay) return "attended";
  // Attended tag but no watched-date at all: no per-event signal to contradict
  // it, so trust the tag (rare — attendees in the data always have the field).
  if (hasAttended && !watchedDay) return "attended";
  // Resolved, but the most recent watch was NOT this webinar → missed this one.
  return "missed";
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
  const [lpField, webinarField, watchedField] = await Promise.all([
    resolveCustomField(config.lpFieldKey),
    resolveCustomField(config.webinarDateFieldKey),
    resolveCustomField(config.webinarWatchedFieldKey),
  ]);
  const fieldId = lpField?.id || null;
  const webinarFieldId = webinarField?.id || null;
  const watchedFieldId = watchedField?.id || null;

  // Widened fetch: pull contacts from lookbackDays before the window so that
  // webinar-day attendance and booking attribution inside the window are complete.
  const startDate = toDate(startISO);
  const widenedStartISO = new Date(
    startDate.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000
  ).toISOString();

  let contacts = [];
  if (fieldId) {
    const [control, test] = await Promise.all([
      searchContactsByDateAdded(widenedStartISO, endISO, [
        customFieldFilter(fieldId, config.landingPages.control.value),
      ]),
      searchContactsByDateAdded(widenedStartISO, endISO, [
        customFieldFilter(fieldId, config.landingPages.test.value),
      ]),
    ]);
    contacts = [
      ...control.map((c) => ({ contact: c, lp: "control" })),
      ...test.map((c) => ({ contact: c, lp: "test" })),
    ];
  } else {
    const all = await searchContactsByDateAdded(widenedStartISO, endISO);
    contacts = all.map((c) => ({ contact: c, lp: classify(readField(c, fieldId)) }));
  }

  // contactId -> lp, for booking attribution.
  const cohortLp = new Map();
  for (const { contact, lp } of contacts) {
    if (contact.id) cohortLp.set(contact.id, lp);
  }

  // Day buckets for the visible window only.
  const days = dayRange(startISO, endISO);
  const daysSet = new Set(days);
  const daily = new Map();
  const ensure = (d) => {
    if (!daily.has(d))
      daily.set(d, { control: emptyBucket(), test: emptyBucket() });
    return daily.get(d);
  };
  for (const d of days) ensure(d);
  const inWindow = (d) => d && daysSet.has(d);

  // 1. New contacts (by registration day) + 2. attendance (by webinar day).
  for (const { contact, lp } of contacts) {
    if (lp === "other") continue;

    const regDay = dayKey(contact.dateAdded);
    if (inWindow(regDay)) ensure(regDay)[lp].contacts += 1;

    const webRaw = readField(contact, webinarFieldId);
    const webDay = webRaw ? plainDateKey(webRaw) : null;
    if (inWindow(webDay)) {
      const att = attendanceOn(contact, webDay, watchedFieldId);
      if (att === "attended") ensure(webDay)[lp].attended += 1;
      else if (att === "missed") ensure(webDay)[lp].missed += 1;
    }
  }

  // 3. Bookings (by the day the appointment was booked).
  const excluded = config.apptExcludeStatuses.map(norm);
  const startMs = startDate.getTime();
  const fwdMs =
    toDate(endISO).getTime() + config.bookingForwardDays * 24 * 60 * 60 * 1000;
  const lookupCache = new Map();
  let apptCounted = 0;

  const calJobs = [
    { key: "autobook", id: config.calendars.autobook.id },
    { key: "va", id: config.calendars.va.id },
  ];
  for (const job of calJobs) {
    if (!job.id) continue;
    const events = await getCalendarEvents(job.id, startMs, fwdMs);
    // A contact who reschedules produces several appointment events for the same
    // booking. Count each booker once per calendar, on their EARLIEST in-window
    // booking day, so reschedules don't inflate booking totals.
    events.sort((a, b) => toDate(a.dateAdded) - toDate(b.dateAdded));
    const bookedContacts = new Set();
    for (const ev of events) {
      if (ev.deleted) continue;
      const status = norm(ev.appointmentStatus || ev.appoinmentStatus);
      if (status && excluded.includes(status)) continue;
      const bookDay = dayKey(ev.dateAdded);
      if (!inWindow(bookDay)) continue;
      const cid = ev.contactId || ev.contact?.id;
      if (!cid) continue;
      if (bookedContacts.has(cid)) continue; // already counted this booker

      // Landing page of the booking's contact.
      let lp = cohortLp.get(cid);
      if (lp === undefined) {
        if (!lookupCache.has(cid)) {
          const c = await getContact(cid);
          lookupCache.set(cid, c ? classify(readField(c, fieldId)) : "other");
        }
        lp = lookupCache.get(cid);
      }
      if (lp !== "control" && lp !== "test") continue;

      bookedContacts.add(cid);
      ensure(bookDay)[lp][job.key] += 1;
      apptCounted += 1;
    }
  }

  // Assemble rows + totals.
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
      cohortBasis: "event_day",
      fieldResolved: lpField
        ? { id: lpField.id, fieldKey: lpField.fieldKey, name: lpField.name }
        : null,
      webinarFieldResolved: webinarField
        ? { id: webinarField.id, fieldKey: webinarField.fieldKey, name: webinarField.name }
        : null,
      watchedFieldResolved: watchedField
        ? { id: watchedField.id, fieldKey: watchedField.fieldKey, name: watchedField.name }
        : null,
      lpFieldKeyRequested: config.lpFieldKey,
      webinarDateFieldKeyRequested: config.webinarDateFieldKey,
      landingPages: {
        control: config.landingPages.control,
        test: config.landingPages.test,
      },
      calendars: { autobook: config.calendars.autobook, va: config.calendars.va },
      tags: config.tags,
      apptExcludeStatuses: config.apptExcludeStatuses,
      lookbackDays: config.lookbackDays,
      contactsFetched: contacts.length,
      appointmentsCounted: apptCounted,
      warnings: buildWarnings(lpField, webinarField, watchedField),
    },
    totals,
    daily: dailyRows,
  };
}

function buildWarnings(lpField, webinarField, watchedField) {
  const warnings = [];
  if (!lpField) {
    warnings.push(
      `Landing page custom field "${config.lpFieldKey}" could not be resolved in GHL. Check GHL_LP_FIELD_KEY.`
    );
  }
  if (!webinarField) {
    warnings.push(
      `Webinar-date field "${config.webinarDateFieldKey}" could not be resolved — attended/missed cannot be placed on the webinar day and will read 0. Check GHL_WEBINAR_DATE_FIELD_KEY.`
    );
  }
  if (!watchedField) {
    warnings.push(
      `Webinar-watched field "${config.webinarWatchedFieldKey}" could not be resolved — attendance falls back to sticky tags, which over-counts attended for repeat registrants. Check GHL_WEBINAR_WATCHED_FIELD_KEY.`
    );
  }
  if (!config.calendars.autobook.id)
    warnings.push("CALENDAR_AUTOBOOK_ID is not set — autobook counts will be 0.");
  if (!config.calendars.va.id)
    warnings.push("CALENDAR_VA_ID is not set — VA calendar counts will be 0.");
  return warnings;
}
