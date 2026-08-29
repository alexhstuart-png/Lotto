// Friday payment reminder logic.
//
// Schedule: Friday 08:00 Australia/Perth. Perth is UTC+8 with no daylight
// saving, so the Netlify cron is Friday 00:00 UTC ("0 0 * * 5") — see
// netlify.toml and DEPLOY.md.
//
// Dedupe: at most ONE automatic reminder per member per Perth Friday,
// enforced by an email_logs lookup before every send.

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8, no DST

/** The calendar date (YYYY-MM-DD) in Australia/Perth for a given instant. */
export function perthDateString(date = new Date()) {
  return new Date(date.getTime() + PERTH_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start/end of the current Perth calendar day, as UTC instants. */
export function perthDayWindow(date = new Date()) {
  const dayStr = perthDateString(date);
  const startUtc = new Date(new Date(dayStr + 'T00:00:00Z').getTime() - PERTH_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { dayStr, startUtc, endUtc };
}

/**
 * Decide who gets a reminder. Pure — unit-tested.
 *
 * Skips: inactive members, members with notifications disabled, members whose
 * balance is above the threshold (prepay model: remind at or below, so people
 * top up before ever going negative), and members already sent a reminder
 * today (Perth time) per email_logs.
 *
 * @param {Array} members            member rows
 * @param {Map<string,number>} balances   member_id -> balance cents (from ledger)
 * @param {Array} todaysReminderLogs email_logs rows of type 'reminder' sent within today's Perth window
 * @param {number} owingThresholdCents    remind when balance < this
 */
export function selectReminderRecipients(members, balances, todaysReminderLogs, owingThresholdCents) {
  const alreadySent = new Set(
    todaysReminderLogs.filter((l) => l.status === 'sent').map((l) => l.member_id)
  );
  return members.filter((m) => {
    if (!m.is_active) return false;
    if (!m.notifications_enabled) return false;
    if (alreadySent.has(m.id)) return false;
    const balance = balances.get(m.id) ?? 0;
    return balance <= owingThresholdCents;
  });
}
