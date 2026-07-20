// Thin GoHighLevel v2 API client. Uses the built-in fetch (Node 18+).
import { config } from "./config.js";

function headers() {
  return {
    Authorization: `Bearer ${config.ghl.token}`,
    Version: config.ghl.apiVersion,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function ghlFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${config.ghl.baseUrl}${path}`;
  const res = await fetch(url, { ...options, headers: headers() });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const message =
      body?.message || body?.error || body?.raw || `HTTP ${res.status}`;
    const err = new Error(
      `GHL ${res.status} on ${path}: ${
        Array.isArray(message) ? message.join("; ") : message
      }`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Resolve the landing-page custom field's id from a human-friendly key/name.
// Returns { id, fieldKey, name } or null if it can't be found.
export async function resolveCustomField(keyOrName) {
  const wanted = String(keyOrName || "").toLowerCase();
  const data = await ghlFetch(
    `/locations/${config.ghl.locationId}/customFields`
  );
  const fields = data.customFields || data.customField || [];
  const match = fields.find((f) => {
    const candidates = [f.id, f.fieldKey, f.name]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    // fieldKey often looks like "contact.landing_page"; match the suffix too.
    const suffixMatch = candidates.some((c) => c.split(".").pop() === wanted);
    return candidates.includes(wanted) || suffixMatch;
  });
  return match || null;
}

// Search contacts created within [startISO, endISO], optionally narrowed by
// extra filters (e.g. a landing-page custom field). Uses searchAfter cursor
// pagination (GHL's recommended, cap-free method). Returns full contact objects
// (with customFields + tags).
export async function searchContactsByDateAdded(startISO, endISO, extraFilters = []) {
  const all = [];
  const pageLimit = 100;
  const maxPages = 1000; // hard stop against runaway loops
  let searchAfter = null;

  for (let i = 0; i < maxPages; i++) {
    const body = {
      locationId: config.ghl.locationId,
      pageLimit,
      filters: [
        {
          field: "dateAdded",
          operator: "range",
          value: { gte: startISO, lte: endISO },
        },
        ...extraFilters,
      ],
      sort: [{ field: "dateAdded", direction: "asc" }],
    };
    if (searchAfter) body.searchAfter = searchAfter;

    const data = await ghlFetch(`/contacts/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < pageLimit) break;
    // Cursor for the next page = searchAfter of the last returned contact.
    searchAfter = contacts[contacts.length - 1]?.searchAfter;
    if (!searchAfter) break;
  }
  return all;
}

// Build a GHL search filter for a custom-field exact match.
export function customFieldFilter(fieldId, value) {
  return { field: `customFields.${fieldId}`, operator: "eq", value };
}

// Fetch a single contact by id (used to resolve appointment owners not already
// in the fetched set). Returns the contact object or null.
export async function getContact(id) {
  try {
    const data = await ghlFetch(`/contacts/${id}`);
    return data.contact || data || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// List all calendars in the location (id + name), for discovery/config.
export async function listCalendars() {
  const params = new URLSearchParams({ locationId: config.ghl.locationId });
  const data = await ghlFetch(`/calendars/?${params.toString()}`);
  return data.calendars || [];
}

// List all custom fields (id + fieldKey + name), for discovery/config.
export async function listCustomFields() {
  const data = await ghlFetch(
    `/locations/${config.ghl.locationId}/customFields`
  );
  return data.customFields || data.customField || [];
}

// Fetch calendar events (appointments) for a calendar within a time window.
// startMs/endMs are epoch milliseconds.
export async function getCalendarEvents(calendarId, startMs, endMs) {
  if (!calendarId) return [];
  const params = new URLSearchParams({
    locationId: config.ghl.locationId,
    calendarId,
    startTime: String(startMs),
    endTime: String(endMs),
  });
  const data = await ghlFetch(`/calendars/events?${params.toString()}`);
  return data.events || [];
}
