// Timezone-aware day-window helpers. A day the user picks (e.g. "2026-07-20")
// must map to that calendar day in the DASHBOARD timezone, converted to the
// correct UTC instants — not naive UTC midnight, which would smear a single-day
// view across two local days.

// Minutes that `tz` is ahead of UTC at the given instant.
function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  let hour = map.hour === "24" ? "00" : map.hour;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second)
  );
  // Offsets are whole minutes; round to shed sub-minute error from dropped ms.
  return Math.round((asUTC - date.getTime()) / 60000);
}

// The UTC instant corresponding to local `dateStr` at the given wall-clock time.
function zonedInstant(dateStr, tz, hh, mm, ss, ms) {
  // Naive UTC for that wall time, then shift by the tz offset at that moment.
  const naive = new Date(
    `${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(
      ss
    ).padStart(2, "0")}.${String(ms).padStart(3, "0")}Z`
  );
  const offset = tzOffsetMinutes(naive, tz);
  return new Date(naive.getTime() - offset * 60000);
}

export function zonedStartOfDayISO(dateStr, tz) {
  return zonedInstant(dateStr, tz, 0, 0, 0, 0).toISOString();
}

export function zonedEndOfDayISO(dateStr, tz) {
  return zonedInstant(dateStr, tz, 23, 59, 59, 999).toISOString();
}

// "YYYY-MM-DD" for an instant, in the given tz.
export function localDateStr(date, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
