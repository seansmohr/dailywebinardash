// Central configuration, all driven by environment variables so the same
// build can be pointed at any GHL sub-account / field / tag / calendar setup
// without code changes.

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
    locationId: process.env.GHL_LOCATION_ID || "",
    baseUrl: process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com",
    apiVersion: process.env.GHL_API_VERSION || "2021-07-28",
  },

  // ---- Landing page split-test definition ----
  // The contact custom field that stores the landing page value. Matched
  // (case-insensitively) against the field's fieldKey, name, or id.
  lpFieldKey: process.env.GHL_LP_FIELD_KEY || "landing_page",
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

  // ---- Attendance tags ----
  // Comma-separated so you can list every variant your workflows apply.
  tags: {
    attended: csv(process.env.TAG_ATTENDED, ["attended"]),
    missed: csv(process.env.TAG_MISSED, ["missed", "no-show", "no show", "noshow"]),
  },

  // ---- Appointment calendars ----
  calendars: {
    autobook: {
      id: process.env.CALENDAR_AUTOBOOK_ID || "",
      label: process.env.CALENDAR_AUTOBOOK_LABEL || "Autobook",
    },
    va: {
      id: process.env.CALENDAR_VA_ID || "",
      label: process.env.CALENDAR_VA_LABEL || "VA Calendar",
    },
  },

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
