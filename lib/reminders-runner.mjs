// Orchestration for Friday payment reminders. Used by the reminders-cron
// scheduled function and the admin "run reminders now" action — both paths go
// through the same email_logs dedupe, so a re-run on the same Perth day can
// never send a member a second reminder.

import { supabase, must, getSettings, memberBalancesCents } from './db.mjs';
import { selectReminderRecipients, perthDayWindow } from './reminders.mjs';
import { sendEmail, reminderEmail } from './email.mjs';

export async function runReminders(now = new Date()) {
  const settings = await getSettings();
  const members = must(await supabase().from('members').select('*'));
  const balances = await memberBalancesCents(members.map((m) => m.id));

  const { dayStr, startUtc, endUtc } = perthDayWindow(now);
  const todaysLogs = must(
    await supabase().from('email_logs')
      .select('member_id, status')
      .eq('type', 'reminder')
      .gte('sent_at', startUtc.toISOString())
      .lt('sent_at', endUtc.toISOString())
  );

  const recipients = selectReminderRecipients(
    members, balances, todaysLogs, settings.owing_threshold_cents
  );

  let sent = 0;
  let failed = 0;
  for (const m of recipients) {
    const tpl = reminderEmail({
      memberName: m.name,
      balanceCents: balances.get(m.id) ?? 0,
      weeklyChargeCents: settings.weekly_charge_cents,
    });
    const res = await sendEmail({
      ...tpl, to: m.email, type: 'reminder', memberId: m.id,
      meta: { perth_day: dayStr, balance_cents: balances.get(m.id) ?? 0 },
    });
    res.sent ? sent++ : failed++;
  }
  return { perth_day: dayStr, eligible: recipients.length, sent, failed };
}
