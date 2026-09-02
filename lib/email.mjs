// Resend email sending. RESEND_API_KEY lives only in Netlify env vars.
// Every send is recorded in email_logs (which also powers reminder dedupe).

import { supabase, T } from './db.mjs';

const RESEND_URL = 'https://api.resend.com/emails';

function fromAddress() {
  return process.env.EMAIL_FROM || 'Work Lotto <onboarding@resend.dev>';
}

export function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Send one email via Resend and log it. Never throws — returns
 * { sent: boolean } so callers (especially scheduled functions) keep going.
 */
export async function sendEmail({ to, subject, html, type, memberId = null, drawId = null, meta = null }) {
  let status = 'failed';
  let resendId = null;
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY not configured');
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, html }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      resendId = body.id ?? null;
      status = 'sent';
    } else {
      const text = await res.text().catch(() => '');
      console.error(`Resend ${res.status} sending "${subject}" to ${to}: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`Email send error ("${subject}" to ${to}):`, err.message);
  }
  try {
    await supabase().from(T('email_logs')).insert({
      type,
      member_id: memberId,
      draw_id: drawId,
      to_email: to,
      subject,
      status,
      resend_id: resendId,
      meta,
    });
  } catch (err) {
    console.error('email_logs insert failed:', err.message);
  }
  return { sent: status === 'sent' };
}

// ---------------------------------------------------------------------------
// Templates — simple, email-client-safe inline styles.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ballRow(numbers, powerball) {
  const main = numbers
    .map((n) => `<span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#1d2540;color:#fff;text-align:center;font-weight:bold;margin-right:4px;">${n}</span>`)
    .join('');
  const pb = `<span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#c9a227;color:#141414;text-align:center;font-weight:bold;">${powerball}</span>`;
  return `${main}<span style="margin:0 6px;color:#888;">PB</span>${pb}`;
}

const wrap = (inner) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0e1220;padding:24px;color:#e8e6df;">
    <div style="max-width:560px;margin:0 auto;background:#161c30;border-radius:12px;padding:24px;border:1px solid #2a3352;">
      <h1 style="font-family:Impact,Arial Black,sans-serif;color:#e9c46a;letter-spacing:1px;margin:0 0 16px;">WORK LOTTO SYNDICATE</h1>
      ${inner}
      <p style="color:#8b93ad;font-size:12px;margin-top:24px;">You're receiving this because you're a member of the work Powerball syndicate. Manage notifications from your Account page.</p>
    </div>
  </div>`;

function formatDrawDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00+08:00');
  return d.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
  });
}

export function ticketPublishedEmail({ memberName, drawDate, games, costCents, kittyCents, balanceCents = null, weeklyChargeCents = 2500 }) {
  const gameRows = games
    .map((g, i) => `<tr><td style="padding:6px 10px 6px 0;color:#8b93ad;">Game ${i + 1}</td><td style="padding:6px 0;">${ballRow(g.numbers, g.powerball)}</td></tr>`)
    .join('');
  const niceDate = formatDrawDate(drawDate);
  // Prepay model: $25 or less left means one draw of credit — nudge to top up.
  const balanceBlock = balanceCents === null ? '' : (
    balanceCents <= weeklyChargeCents
      ? `<p style="background:rgba(231,111,81,0.12);border:1px solid #e76f51;border-radius:8px;padding:10px 14px;">
           Your kitty balance is <strong style="color:#e76f51;">${formatMoney(balanceCents)}</strong> —
           that's your last draw's worth. Please top up before next Thursday to stay in.</p>`
      : `<p>Your kitty balance: <strong style="color:#35c46f;">${formatMoney(balanceCents)}</strong></p>`
  );
  return {
    subject: `Powerball ticket is in — ${niceDate}`,
    html: wrap(`
      <p>Hi ${esc(memberName)},</p>
      <p>This week's ticket is locked in for the Powerball draw on <strong>${esc(niceDate)}</strong>. Here are our numbers — good luck!</p>
      <table style="border-collapse:collapse;margin:12px 0;">${gameRows}</table>
      <p>Ticket cost: <strong>${formatMoney(costCents)}</strong><br>
         Syndicate kitty: <strong>${formatMoney(kittyCents)}</strong></p>
      ${balanceBlock}
    `),
  };
}

export function reminderEmail({ memberName, balanceCents, weeklyChargeCents }) {
  return {
    subject: 'Powerball syndicate — payment reminder',
    html: wrap(`
      <p>Hi ${esc(memberName)},</p>
      <p>Friendly reminder: your syndicate balance is <strong style="color:#e76f51;">${formatMoney(balanceCents)}</strong>.</p>
      <p>The weekly Powerball ticket is ${formatMoney(weeklyChargeCents)}. Please top up when you get a chance so you stay in the draw.</p>
    `),
  };
}

export function adminScrapeFailedEmail({ drawDate, attempts, lastError }) {
  return {
    subject: `Powerball results auto-retrieve FAILED for draw ${esc(drawDate)}`,
    html: wrap(`
      <p>The automatic Powerball results retrieval failed after ${attempts} attempts for the draw on <strong>${esc(drawDate)}</strong>.</p>
      <p style="color:#e76f51;">Last error: ${esc(lastError || 'unknown')}</p>
      <p>The draw is now marked <strong>"Results pending — auto retrieve failed"</strong>. Please enter the official numbers manually via Admin → Enter Official Results. Matching will run automatically when you save.</p>
    `),
  };
}

export function inviteEmail({ memberName, link, isReset }) {
  return {
    subject: isReset
      ? 'Reset your Work Lotto Syndicate password'
      : "You're in the syndicate — set your password",
    html: wrap(`
      <p>Hi ${esc(memberName)},</p>
      ${isReset
        ? '<p>A password reset was requested for your Work Lotto Syndicate account.</p>'
        : "<p>You've been added to the work Powerball syndicate! Set your password to get started.</p>"}
      <p style="margin:24px 0;">
        <a href="${esc(link)}" style="display:inline-block;background:#e9c46a;color:#1c1503;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;">Set my password</a>
      </p>
      <p style="color:#8b93ad;font-size:12px;">This link works once and expires in 7 days. If the button doesn't work, paste this into your browser:<br>${esc(link)}</p>
    `),
  };
}

export function announceWinEmail({ memberName, drawDate, division, amountCents, addedToKitty }) {
  return {
    subject: `WE WON! Powerball draw ${esc(drawDate)}`,
    html: wrap(`
      <p>Hi ${esc(memberName)},</p>
      <p style="font-size:18px;">🎉 The syndicate had a winning line in the Powerball draw on <strong>${esc(drawDate)}</strong>!</p>
      <p>${division ? `Division ${division} — ` : ''}<strong style="color:#e9c46a;">${formatMoney(amountCents)}</strong>
      ${addedToKitty ? '(added to the kitty)' : ''}</p>
      <p>Open the site to see the winning ticket highlighted.</p>
    `),
  };
}
