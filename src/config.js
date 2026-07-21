// Central configuration, all driven by environment variables so the same
// build can be pointed at any GHL sub-account / field / tag / calendar setup
// without code changes.
//
// The defaults below are the VERIFIED values for the Mohr Insurance sub-account
// (location dTtT96ODx29mbQcdOp0v), discovered live via the GHL API. They are
// account identifiers, not secrets — the only secret is GHL_API_TOKEN. Override
// any of them with an env var if the setup changes.

function csv(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT) || 3000,

  // ---- GoHighLevel API (Private Integration token) ----
  ghl: {
    // Private Integration token: Sub-Account Settings > Private Integrations.
    token: process.env.GHL_API_TOKEN || "",
    locationId: process.env.GHL_LOCATION_ID || "dTtT96ODx29mbQcdOp0v",
    baseUrl: process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com",
    apiVersion: process.env.GHL_API_VERSION || "2021-07-28",
  },

  // ---- Landing page split-test definition ----
  // The contact custom field that stores the landing page value. Matched
  // (case-insensitively) against the field's fieldKey, name, or id.
  // Verified: "Landing Page" (contact.landing_page, id fTDU51m5BZslEG63pdfN).
  lpFieldKey: process.env.GHL_LP_FIELD_KEY || "contact.landing_page",
  landingPages: {
    control: {
      value: process.env.LP_CONTROL_VALUE || "medicare101_landing_page_b",
      label: process.env.LP_CONTROL_LABEL || "Landing Page B (control)",
    },
    test: {
      value: process.env.LP_TEST_VALUE || "medicare101_landing_page_daily",
      label: process.env.LP_TEST_LABEL || "Daily (test)",
    },
  },

  // ---- Attendance tags (comma-separated, case-insensitive) ----
  // Verified: a lead gets "attended webinar" by clicking the webinar trigger
  // link; otherwise "missed webinar".
  tags: {
    attended: csv(process.env.TAG_ATTENDED, ["attended webinar"]),
    missed: csv(process.env.TAG_MISSED, ["missed webinar", "no show"]),
  },

  // ---- Appointment calendars ----
  // Verified: autobook = "Turning 65 Medicare Call"; va = "VA Calendar".
  calendars: {
    autobook: {
      id: process.env.CALENDAR_AUTOBOOK_ID || "jDfKPflpQai5OB0v7m0C",
      label: process.env.CALENDAR_AUTOBOOK_LABEL || "Autobook (Turning 65)",
    },
    va: {
      id: process.env.CALENDAR_VA_ID || "iDBM1sRSqiZBWhblcGPD",
      label: process.env.CALENDAR_VA_LABEL || "VA Calendar",
    },
  },

  // Contact custom field holding the scheduled webinar date. Attended/missed
  // are bucketed on THIS date (the day the webinar ran), not the signup day.
  // Verified: "Date - Webinar Time/Date" (contact.date__webinar_timedate,
  // id MW85KtwyuHBreKUD5aRo), stored as a date at midnight UTC.
  webinarDateFieldKey:
    process.env.GHL_WEBINAR_DATE_FIELD_KEY || "contact.date__webinar_timedate",

  // How many days before the window start to also pull contacts, so that
  // webinar-day attendance and booking-day counts inside the window are
  // complete even when the contact signed up well before the event.
  lookbackDays: Number(process.env.ATTENDANCE_LOOKBACK_DAYS) || 60,

  // Days after the window end to scan appointment slots, so bookings MADE in
  // the window whose appointment is scheduled later are still captured.
  bookingForwardDays: Number(process.env.BOOKING_FORWARD_DAYS) || 90,

  // Appointment statuses that do NOT count as a booking (comma-separated).
  // A cancelled appointment isn't a live booking; noshow/showed/confirmed count.
  apptExcludeStatuses: csv(process.env.APPT_EXCLUDE_STATUSES, ["cancelled"]),

  // Timezone used to bucket everything into calendar days.
  timezone: process.env.DASHBOARD_TZ || "America/New_York",

  // Optional HTTP Basic Auth to keep the dashboard private on Railway.
  auth: {
    user: process.env.DASHBOARD_USER || "",
    password: process.env.DASHBOARD_PASSWORD || "",
  },
};

export function assertConfigured() {
  const missing = [];
  if (!config.ghl.token) missing.push("GHL_API_TOKEN");
  if (!config.ghl.locationId) missing.push("GHL_LOCATION_ID");
  return missing;
}
