// GHL discovery tool. Inspects your account and prints exactly how to configure
// the dashboard: custom fields, the landing-page value distribution, calendars,
// and the tags actually in use. Prints NO PII (no names/emails/phones) — only
// field ids, value strings, tag names, and counts.
//
// Usage (needs GHL_API_TOKEN + GHL_LOCATION_ID in the environment):
//   npm run discover
//
import { config } from "./config.js";
import {
  listCustomFields,
  listCalendars,
  searchContactsByDateAdded,
} from "./ghl.js";

function line(n = 60) {
  return "─".repeat(n);
}
function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

async function main() {
  if (!config.ghl.token || !config.ghl.locationId) {
    console.error(
      "Set GHL_API_TOKEN and GHL_LOCATION_ID first (see .env.example)."
    );
    process.exit(1);
  }

  console.log(line());
  console.log("GHL DISCOVERY  ·  location", config.ghl.locationId);
  console.log(line());

  // 1. Custom fields ---------------------------------------------------------
  let fields = [];
  try {
    fields = await listCustomFields();
  } catch (e) {
    console.error("Could not list custom fields:", e.message);
  }
  console.log(`\nCUSTOM FIELDS (${fields.length})`);
  for (const f of fields) {
    console.log(`  • ${f.name}`);
    console.log(`      fieldKey: ${f.fieldKey}    id: ${f.id}    type: ${f.dataType || f.type || "?"}`);
  }
  // Best guess at the landing-page field.
  const lpGuess = fields.find((f) =>
    [f.name, f.fieldKey].some((x) => norm(x).includes("landing"))
  );

  // 2. Calendars -------------------------------------------------------------
  let calendars = [];
  try {
    calendars = await listCalendars();
  } catch (e) {
    console.error("Could not list calendars:", e.message);
  }
  console.log(`\nCALENDARS (${calendars.length})`);
  for (const c of calendars) {
    console.log(`  • ${c.name}`);
    console.log(`      id: ${c.id}`);
  }
  const autoGuess = calendars.find((c) => norm(c.name).includes("auto"));
  const vaGuess = calendars.find((c) => norm(c.name).includes("va"));

  // 3. Sample recent contacts for value + tag distribution -------------------
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  let contacts = [];
  try {
    contacts = await searchContactsByDateAdded(
      start.toISOString(),
      end.toISOString()
    );
  } catch (e) {
    console.error("Could not sample contacts:", e.message);
  }
  console.log(`\nSAMPLED ${contacts.length} contacts from the last 30 days.`);

  // Landing-page value distribution across all custom fields, so we can spot
  // which field actually carries the medicare101_* values.
  const valueCountsByField = new Map(); // fieldId -> Map(value -> count)
  const tagCounts = new Map();
  for (const c of contacts) {
    for (const t of c.tags || []) {
      const k = norm(t);
      tagCounts.set(k, (tagCounts.get(k) || 0) + 1);
    }
    for (const cf of c.customFields || c.custom_fields || []) {
      const fid = cf.id || cf.customFieldId || cf.field;
      const val = cf.value ?? cf.field_value ?? cf.fieldValue;
      if (!fid || val == null || val === "") continue;
      if (!valueCountsByField.has(fid)) valueCountsByField.set(fid, new Map());
      const m = valueCountsByField.get(fid);
      const key = String(val);
      m.set(key, (m.get(key) || 0) + 1);
    }
  }

  // Which field holds the medicare101_landing_page_* values?
  const targetValues = [
    norm(config.landingPages.control.value),
    norm(config.landingPages.test.value),
  ];
  let lpFieldByValue = null;
  for (const [fid, m] of valueCountsByField) {
    for (const v of m.keys()) {
      if (targetValues.includes(norm(v))) {
        lpFieldByValue = fid;
        break;
      }
    }
    if (lpFieldByValue) break;
  }

  const lpField = lpFieldByValue
    ? fields.find((f) => f.id === lpFieldByValue) || { id: lpFieldByValue }
    : lpGuess;

  if (lpField && valueCountsByField.has(lpField.id)) {
    console.log(
      `\nLANDING-PAGE FIELD VALUES  (field "${lpField.name || lpField.fieldKey || lpField.id}")`
    );
    const m = valueCountsByField.get(lpField.id);
    for (const [v, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      const mark = targetValues.includes(norm(v)) ? "  <-- split-test value" : "";
      console.log(`  ${String(n).padStart(4)}  ${v}${mark}`);
    }
  } else {
    console.log(
      "\nCould not auto-detect the landing-page field from sampled data " +
        "(no contact in the last 30 days had a medicare101_landing_page_* value)."
    );
  }

  // Top tags — helps confirm attended/missed names.
  console.log(`\nTOP TAGS (last 30 days)`);
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t, n] of sortedTags.slice(0, 30)) {
    const isAtt = config.tags.attended.map(norm).includes(t);
    const isMiss = config.tags.missed.map(norm).includes(t);
    const mark = isAtt ? "  [attended]" : isMiss ? "  [missed]" : "";
    console.log(`  ${String(n).padStart(4)}  ${t}${mark}`);
  }

  // 4. Suggested env vars ----------------------------------------------------
  console.log(`\n${line()}\nSUGGESTED ENV VARS\n${line()}`);
  if (lpField) console.log(`GHL_LP_FIELD_KEY=${lpField.fieldKey || lpField.name || lpField.id}`);
  else console.log(`GHL_LP_FIELD_KEY=<not found — check CUSTOM FIELDS above>`);
  if (autoGuess) console.log(`CALENDAR_AUTOBOOK_ID=${autoGuess.id}   # ${autoGuess.name}`);
  else console.log(`CALENDAR_AUTOBOOK_ID=<pick from CALENDARS above>`);
  if (vaGuess) console.log(`CALENDAR_VA_ID=${vaGuess.id}   # ${vaGuess.name}`);
  else console.log(`CALENDAR_VA_ID=<pick from CALENDARS above>`);
  console.log(`\nReview the TAGS list and set TAG_ATTENDED / TAG_MISSED to match.`);
  console.log(line());
}

main().catch((e) => {
  console.error("Discovery failed:", e.message);
  process.exit(1);
});
