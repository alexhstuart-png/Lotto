// Work Lotto Syndicate API — single catch-all Netlify Function.
// All server-side logic lives here or in ../../lib. Secrets (Supabase service
// role key, Resend key, session secret) come only from Netlify env vars.
// Every admin route re-verifies the admin role from the signed session —
// nothing role-related is ever trusted from the client.

import bcrypt from 'bcryptjs';
import {
  T,
  supabase, must, chargeDb, getSettings, auditLog,
  memberBalanceCents, memberBalancesCents, kittyBalanceCents,
} from '../../lib/db.mjs';
import {
  signSession, sessionCookie, clearSessionCookie, sessionFromRequest,
} from '../../lib/auth.mjs';
import {
  validateGame, validateResult, validateEmail, validateName,
  validateCents, validateDate, validateUuid,
} from '../../lib/validate.mjs';
import { matchTicket } from '../../lib/matching.mjs';
import { chargeMembersForDraw } from '../../lib/ledger.mjs';
import { saveResultsAndProcess } from '../../lib/results-pipeline.mjs';
import { sendEmail, ticketPublishedEmail, announceWinEmail, inviteEmail } from '../../lib/email.mjs';
import { selectBroadcastAudience } from '../../lib/audience.mjs';
import { runReminders } from '../../lib/reminders-runner.mjs';
import { createInviteToken, verifyInviteToken, validatePassword } from '../../lib/invites.mjs';

export const config = { path: '/api/*' };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
const err = (message, status = 400) => json({ error: message }, status);

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Shared read helpers
// ---------------------------------------------------------------------------

/** Strip credential fields before a member row leaves the server. */
function publicMember(m) {
  if (!m) return m;
  const { password_hash, reset_token_hash, reset_token_expires, ...rest } = m;
  return { ...rest, has_password: !!password_hash, invite_pending: !!reset_token_hash };
}

/** Full detail for one draw: ticket, games, results, live matching. */
async function drawDetail(draw) {
  const ticket = must(await supabase().from(T('tickets')).select('*').eq('draw_id', draw.id).maybeSingle());
  let games = [];
  if (ticket) {
    games = must(
      await supabase().from(T('games')).select('id, game_index, numbers, powerball')
        .eq('ticket_id', ticket.id).order('game_index')
    );
  }
  const result = must(await supabase().from(T('results')).select('*').eq('draw_id', draw.id).maybeSingle());
  let matching = null;
  if (result && games.length > 0) {
    matching = matchTicket(games, { numbers: result.numbers, powerball: result.powerball });
  }
  const winnings = must(await supabase().from(T('winnings')).select('*').eq('draw_id', draw.id));
  return {
    draw,
    ticket: ticket ? {
      id: ticket.id, cost_cents: ticket.cost_cents, status: ticket.status,
      published_at: ticket.published_at,
    } : null,
    games,
    result: result ? {
      numbers: result.numbers, powerball: result.powerball,
      source: result.source, divisions: result.divisions,
    } : null,
    matching,
    winnings,
  };
}

async function latestDraw() {
  const draws = must(
    await supabase().from(T('draws')).select('*').order('draw_date', { ascending: false }).limit(1)
  );
  return draws[0] ?? null;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleLogin(req) {
  const { email, password } = await readBody(req);
  const cleanEmail = validateEmail(email);
  if (!cleanEmail || typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return err('Email and password required', 400);
  }
  const member = must(
    await supabase().from(T('members')).select('*').eq('email', cleanEmail).maybeSingle()
  );
  // Constant-shaped failure: same message whether the email is unknown, the
  // member is inactive, they haven't set a password yet, or it's wrong.
  const fail = () => err('Invalid email or password', 401);
  if (!member || !member.is_active || !member.password_hash) return fail();

  const ok = await bcrypt.compare(password, member.password_hash);
  if (!ok) return fail();

  const token = signSession({ memberId: member.id, role: member.role });
  return json(
    { member: { id: member.id, name: member.name, email: member.email, role: member.role } },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}

/** Public: set a password from an emailed invite/reset link. Single-use. */
async function handleSetPassword(req) {
  const { email, token, password } = await readBody(req);
  const cleanEmail = validateEmail(email);
  if (!cleanEmail) return err('Invalid link', 400);
  if (!validatePassword(password)) return err('Password must be 8-100 characters', 400);
  const member = must(
    await supabase().from(T('members')).select('*').eq('email', cleanEmail).maybeSingle()
  );
  if (!member || !member.is_active || !verifyInviteToken(member, token)) {
    return err('This link is invalid or has expired — ask the admin to send a new one', 400);
  }
  const hash = await bcrypt.hash(password, 10);
  must(
    await supabase().from(T('members'))
      .update({ password_hash: hash, reset_token_hash: null, reset_token_expires: null })
      .eq('id', member.id).select().single()
  );
  await auditLog({ actorId: member.id, action: 'password_set', entity: 'members', entityId: member.id });
  return json({ ok: true });
}

/**
 * Generate a fresh set-password token for a member, store its hash, and email
 * the link. Returns the link too so the admin can pass it on manually if
 * email delivery isn't configured yet.
 */
async function sendInvite(member, { isReset = false } = {}) {
  const { token, tokenHash, expires } = createInviteToken();
  must(
    await supabase().from(T('members'))
      .update({ reset_token_hash: tokenHash, reset_token_expires: expires })
      .eq('id', member.id).select().single()
  );
  const base = (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
  const link = `${base}/#/set-password?email=${encodeURIComponent(member.email)}&token=${token}`;
  const tpl = inviteEmail({ memberName: member.name, link, isReset });
  const { sent } = await sendEmail({ ...tpl, to: member.email, type: 'invite', memberId: member.id });
  return { link, sent };
}

async function handleMe(session) {
  const member = must(await supabase().from(T('members')).select('*').eq('id', session.memberId).maybeSingle());
  if (!member || !member.is_active) return err('Not authenticated', 401);
  return json({
    member: {
      id: member.id, name: member.name, email: member.email, role: member.role,
      notifications_enabled: member.notifications_enabled,
    },
  });
}

async function handleHome(session) {
  const [balance, kitty, draw] = await Promise.all([
    memberBalanceCents(session.memberId),
    kittyBalanceCents(),
    latestDraw(),
  ]);
  const settings = await getSettings();
  const detail = draw ? await drawDetail(draw) : null;
  const totalWinningsRows = must(await supabase().from(T('winnings')).select('amount_cents'));
  const totalWinnings = totalWinningsRows.reduce((s, r) => s + r.amount_cents, 0);
  return json({
    balance_cents: balance,
    kitty_cents: kitty,
    weekly_charge_cents: settings.weekly_charge_cents,
    total_winnings_cents: totalWinnings,
    current: detail,
  });
}

async function handleHistory() {
  const draws = must(
    await supabase().from(T('draws')).select('*').order('draw_date', { ascending: false }).limit(52)
  );
  const items = [];
  for (const d of draws) items.push(await drawDetail(d));
  return json({ draws: items });
}

async function handleAccount(session) {
  const member = must(await supabase().from(T('members')).select('*').eq('id', session.memberId).single());
  const txns = must(
    await supabase().from(T('transactions'))
      .select('id, type, amount_cents, note, created_at, draw_id')
      .eq('member_id', session.memberId)
      .order('created_at', { ascending: false }).limit(100)
  );
  const balance = txns.length === 100
    ? await memberBalanceCents(session.memberId)
    : txns.reduce((s, t) => s + t.amount_cents, 0);
  return json({
    member: {
      id: member.id, name: member.name, email: member.email,
      notifications_enabled: member.notifications_enabled,
    },
    balance_cents: balance,
    transactions: txns,
  });
}

async function handleNotificationsToggle(session, req) {
  const { enabled } = await readBody(req);
  if (typeof enabled !== 'boolean') return err('enabled must be true or false');
  must(
    await supabase().from(T('members')).update({ notifications_enabled: enabled })
      .eq('id', session.memberId).select().single()
  );
  return json({ ok: true, notifications_enabled: enabled });
}

// --- Admin ---------------------------------------------------------------

async function adminOverview() {
  const members = must(await supabase().from(T('members')).select('*').order('name'));
  const balances = await memberBalancesCents(members.map((m) => m.id));
  const kitty = await kittyBalanceCents();
  const settings = await getSettings();
  const draws = must(
    await supabase().from(T('draws')).select('*').order('draw_date', { ascending: false }).limit(20)
  );
  const drawDetails = [];
  for (const d of draws) drawDetails.push(await drawDetail(d));
  const emailLogs = must(
    await supabase().from(T('email_logs'))
      .select('id, type, to_email, subject, status, sent_at')
      .order('sent_at', { ascending: false }).limit(30)
  );
  const kittyTxns = must(
    await supabase().from(T('kitty_transactions')).select('*')
      .order('created_at', { ascending: false }).limit(50)
  );
  return json({
    members: members.map((m) => ({ ...publicMember(m), balance_cents: balances.get(m.id) ?? 0 })),
    kitty_cents: kitty,
    settings: {
      weekly_charge_cents: settings.weekly_charge_cents,
      charge_on_publish: settings.charge_on_publish,
      owing_threshold_cents: settings.owing_threshold_cents,
    },
    draws: drawDetails,
    email_logs: emailLogs,
    kitty_transactions: kittyTxns,
  });
}

async function adminCreateMember(session, req) {
  const body = await readBody(req);
  const name = validateName(body.name);
  const email = validateEmail(body.email);
  if (!name || !email) return err('Valid name and email required');
  const { data, error } = await supabase().from(T('members'))
    .insert({ name, email, role: 'member' }).select().single();
  if (error) return err(error.code === '23505' ? 'A member with that email already exists' : 'Could not create member');
  await auditLog({ actorId: session.memberId, action: 'member_created', entity: 'members', entityId: data.id, details: { name, email } });
  // New members set their own password via an emailed link.
  const invite = await sendInvite(data);
  return json({ member: publicMember(data), invite_link: invite.link, invite_email_sent: invite.sent }, 201);
}

/** Admin: (re)send a set-password link — works as invite and as reset. */
async function adminSendInvite(session, memberId) {
  const id = validateUuid(memberId);
  if (!id) return err('Invalid member id');
  const member = must(await supabase().from(T('members')).select('*').eq('id', id).maybeSingle());
  if (!member) return err('Member not found', 404);
  if (!member.is_active) return err('Member is inactive — reactivate them first');
  const invite = await sendInvite(member, { isReset: !!member.password_hash });
  await auditLog({ actorId: session.memberId, action: 'invite_sent', entity: 'members', entityId: id });
  return json({ invite_link: invite.link, invite_email_sent: invite.sent });
}

async function adminUpdateMember(session, req, memberId) {
  const id = validateUuid(memberId);
  if (!id) return err('Invalid member id');
  const body = await readBody(req);
  const patch = {};
  if (body.name !== undefined) {
    const name = validateName(body.name);
    if (!name) return err('Invalid name');
    patch.name = name;
  }
  if (body.email !== undefined) {
    const email = validateEmail(body.email);
    if (!email) return err('Invalid email');
    patch.email = email;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return err('is_active must be boolean');
    patch.is_active = body.is_active;
  }
  if (body.notifications_enabled !== undefined) {
    if (typeof body.notifications_enabled !== 'boolean') return err('notifications_enabled must be boolean');
    patch.notifications_enabled = body.notifications_enabled;
  }
  if (Object.keys(patch).length === 0) return err('Nothing to update');
  const { data, error } = await supabase().from(T('members')).update(patch).eq('id', id).select().single();
  if (error) return err('Could not update member');
  await auditLog({ actorId: session.memberId, action: 'member_updated', entity: 'members', entityId: id, details: patch });
  return json({ member: publicMember(data) });
}

async function adminCreateDraw(session, req) {
  const body = await readBody(req);
  const drawDate = validateDate(body.draw_date);
  if (!drawDate) return err('draw_date (YYYY-MM-DD) required');
  // Powerball draws are Thursday nights.
  const dow = new Date(drawDate + 'T00:00:00Z').getUTCDay();
  if (dow !== 4) return err('Powerball draws are on Thursdays — pick a Thursday date');
  const drawNumber = body.draw_number === undefined || body.draw_number === null
    ? null : validateCents(body.draw_number, { max: 100000 });
  const { data, error } = await supabase().from(T('draws'))
    .insert({ draw_date: drawDate, draw_number: drawNumber }).select().single();
  if (error) return err(error.code === '23505' ? 'A draw for that date already exists' : 'Could not create draw');
  await auditLog({ actorId: session.memberId, action: 'draw_created', entity: 'draws', entityId: data.id, details: { drawDate } });
  return json({ draw: data }, 201);
}

/** Create or replace the ticket (and its games) for a draw. */
async function adminSaveTicket(session, req) {
  const body = await readBody(req);
  const drawId = validateUuid(body.draw_id);
  if (!drawId) return err('draw_id required');
  const costCents = validateCents(body.cost_cents ?? 0);
  if (costCents === null) return err('Invalid ticket cost');
  if (!Array.isArray(body.games) || body.games.length < 1 || body.games.length > 50) {
    return err('A ticket needs between 1 and 50 games');
  }
  const games = [];
  for (let i = 0; i < body.games.length; i++) {
    const v = validateGame(body.games[i]);
    if (!v.ok) return err(`Game ${i + 1}: ${v.error}`);
    games.push({ game_index: i + 1, numbers: v.numbers, powerball: v.powerball });
  }
  const draw = must(await supabase().from(T('draws')).select('*').eq('id', drawId).maybeSingle());
  if (!draw) return err('Draw not found', 404);

  let ticket = must(await supabase().from(T('tickets')).select('*').eq('draw_id', drawId).maybeSingle());
  const editingPublished = ticket && ticket.status === 'published';
  let previousGames = null;
  if (ticket) {
    if (editingPublished) {
      previousGames = must(
        await supabase().from(T('games')).select('game_index, numbers, powerball')
          .eq('ticket_id', ticket.id).order('game_index')
      );
    }
    must(await supabase().from(T('tickets')).update({ cost_cents: costCents }).eq('id', ticket.id).select().single());
    const { error: delErr } = await supabase().from(T('games')).delete().eq('ticket_id', ticket.id);
    if (delErr) return err('Could not update games');
  } else {
    ticket = must(
      await supabase().from(T('tickets')).insert({ draw_id: drawId, cost_cents: costCents }).select().single()
    );
  }
  const { error: insErr } = await supabase().from(T('games'))
    .insert(games.map((g) => ({ ...g, ticket_id: ticket.id })));
  if (insErr) return err('Could not save games');

  if (editingPublished) {
    // Editing a published ticket: audit-logged, and per the duplicate-charge
    // rule nothing here ever touches the ledger.
    await auditLog({
      actorId: session.memberId, action: 'published_ticket_edited', entity: 'tickets', entityId: ticket.id,
      details: { before: { games: previousGames, cost_cents: ticket.cost_cents }, after: { games, cost_cents: costCents } },
    });
  }
  return json({ ticket_id: ticket.id, games_saved: games.length, edited_published: !!editingPublished });
}

async function adminPublishTicket(session, req, ticketId) {
  const id = validateUuid(ticketId);
  if (!id) return err('Invalid ticket id');
  const ticket = must(await supabase().from(T('tickets')).select('*').eq('id', id).maybeSingle());
  if (!ticket) return err('Ticket not found', 404);
  const draw = must(await supabase().from(T('draws')).select('*').eq('id', ticket.draw_id).single());
  const games = must(
    await supabase().from(T('games')).select('game_index, numbers, powerball')
      .eq('ticket_id', id).order('game_index')
  );
  if (games.length === 0) return err('Add at least one game before publishing');

  const settings = await getSettings();
  const firstPublish = ticket.status !== 'published';

  if (firstPublish) {
    must(
      await supabase().from(T('tickets')).update({
        status: 'published',
        published_at: new Date().toISOString(),
        published_by: session.memberId,
      }).eq('id', id).select().single()
    );
    if (['upcoming'].includes(draw.status)) {
      must(await supabase().from(T('draws')).update({ status: 'waiting_results' }).eq('id', draw.id).select().single());
    }
  } else {
    await auditLog({
      actorId: session.memberId, action: 'ticket_republished', entity: 'tickets', entityId: id, details: {},
    });
  }

  // Charge active members — duplicate-protected by the DB unique index, so a
  // re-publish (or double-click) can never charge anyone twice for this draw.
  let chargeSummary = { charged: [], skipped: [] };
  const allMembers = must(await supabase().from(T('members')).select('*'));
  const activeMembers = allMembers.filter((m) => m.is_active);
  if (settings.charge_on_publish) {
    chargeSummary = await chargeMembersForDraw(
      chargeDb(), activeMembers, draw.id, settings.weekly_charge_cents, session.memberId
    );
  }

  // Kitty pays for the ticket — also exactly once per draw.
  const existingCost = must(
    await supabase().from(T('kitty_transactions')).select('id')
      .eq('draw_id', draw.id).eq('type', 'ticket_cost')
  );
  if (existingCost.length === 0 && ticket.cost_cents > 0) {
    must(
      await supabase().from(T('kitty_transactions')).insert({
        type: 'ticket_cost', amount_cents: -ticket.cost_cents, draw_id: draw.id,
        note: `Powerball ticket ${draw.draw_date}`, created_by: session.memberId,
      }).select().single()
    );
  }

  // Email every active member with notifications enabled — first publish only.
  let emailed = 0;
  if (firstPublish) {
    const kitty = await kittyBalanceCents();
    const audience = selectBroadcastAudience(allMembers);
    for (const m of audience) {
      const tpl = ticketPublishedEmail({
        memberName: m.name, drawDate: draw.draw_date, games,
        costCents: ticket.cost_cents, kittyCents: kitty,
      });
      const { sent } = await sendEmail({
        ...tpl, to: m.email, type: 'ticket_published', memberId: m.id, drawId: draw.id,
      });
      if (sent) emailed++;
    }
  }

  return json({
    published: true,
    first_publish: firstPublish,
    charged: chargeSummary.charged.length,
    charge_skipped: chargeSummary.skipped.length,
    emailed,
  });
}

async function adminEnterResults(session, req) {
  const body = await readBody(req);
  const drawId = validateUuid(body.draw_id);
  if (!drawId) return err('draw_id required');
  const v = validateResult({ numbers: body.numbers, powerball: body.powerball });
  if (!v.ok) return err(v.error);
  let divisions = null;
  if (body.divisions !== undefined && body.divisions !== null) {
    if (!Array.isArray(body.divisions) || body.divisions.length > 9) return err('Invalid divisions');
    divisions = body.divisions.map((d) => ({
      division: validateCents(d.division ?? 0, { max: 9 }),
      note: typeof d.note === 'string' ? d.note.slice(0, 200) : null,
    }));
  }
  const outcome = await saveResultsAndProcess({
    drawId, numbers: v.numbers, powerball: v.powerball, divisions,
    source: 'manual', actorId: session.memberId,
  });
  return json(outcome);
}

async function adminRecordPayment(session, req) {
  const body = await readBody(req);
  const memberId = validateUuid(body.member_id);
  const amount = validateCents(body.amount_cents);
  if (!memberId || amount === null || amount === 0) return err('member_id and a positive amount_cents required');
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : 'Payment received';
  const member = must(await supabase().from(T('members')).select('id, name').eq('id', memberId).maybeSingle());
  if (!member) return err('Member not found', 404);
  // Payment credits the member's ledger AND lands in the kitty.
  must(
    await supabase().from(T('transactions')).insert({
      member_id: memberId, type: 'payment', amount_cents: amount, note, created_by: session.memberId,
    }).select().single()
  );
  must(
    await supabase().from(T('kitty_transactions')).insert({
      type: 'member_payment', amount_cents: amount, member_id: memberId, note, created_by: session.memberId,
    }).select().single()
  );
  return json({ ok: true });
}

async function adminAdjustment(session, req) {
  const body = await readBody(req);
  const amount = validateCents(body.amount_cents, { allowNegative: true });
  if (amount === null || amount === 0) return err('Non-zero amount_cents required');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.slice(0, 200) : null;
  if (!note) return err('A note explaining the adjustment is required');
  if (body.target === 'kitty') {
    must(
      await supabase().from(T('kitty_transactions')).insert({
        type: 'adjustment', amount_cents: amount, note, created_by: session.memberId,
      }).select().single()
    );
  } else {
    const memberId = validateUuid(body.member_id);
    if (!memberId) return err('member_id required for a member adjustment');
    must(
      await supabase().from(T('transactions')).insert({
        member_id: memberId, type: 'adjustment', amount_cents: amount, note, created_by: session.memberId,
      }).select().single()
    );
  }
  await auditLog({ actorId: session.memberId, action: 'adjustment', entity: body.target === 'kitty' ? 'kitty_transactions' : 'transactions', details: { amount, note } });
  return json({ ok: true });
}

async function adminConfirmWinnings(session, req) {
  const body = await readBody(req);
  const drawId = validateUuid(body.draw_id);
  const amount = validateCents(body.amount_cents);
  if (!drawId || amount === null || amount <= 0) return err('draw_id and a positive amount_cents required');
  const division = body.division == null ? null : validateCents(body.division, { max: 9 });
  if (body.division != null && (division === null || division < 1)) return err('division must be 1-9');
  const gameIndex = body.game_index == null ? null : validateCents(body.game_index, { max: 50 });
  const addToKitty = body.add_to_kitty === true;
  const draw = must(await supabase().from(T('draws')).select('*').eq('id', drawId).maybeSingle());
  if (!draw) return err('Draw not found', 404);

  const winning = must(
    await supabase().from(T('winnings')).insert({
      draw_id: drawId, game_index: gameIndex, division, amount_cents: amount,
      added_to_kitty: addToKitty, confirmed_by: session.memberId,
    }).select().single()
  );
  if (addToKitty) {
    must(
      await supabase().from(T('kitty_transactions')).insert({
        type: 'winnings', amount_cents: amount, draw_id: drawId,
        note: `Winnings${division ? ` (Div ${division})` : ''} — draw ${draw.draw_date}`,
        created_by: session.memberId,
      }).select().single()
    );
  }
  must(await supabase().from(T('draws')).update({ status: 'winner' }).eq('id', drawId).select().single());
  await auditLog({
    actorId: session.memberId, action: 'winnings_confirmed', entity: 'winnings', entityId: winning.id,
    details: { amount, division, addToKitty },
  });
  return json({ winning });
}

async function adminAnnounceWin(session, req) {
  const body = await readBody(req);
  const winningId = validateUuid(body.winning_id);
  if (!winningId) return err('winning_id required');
  const winning = must(await supabase().from(T('winnings')).select('*').eq('id', winningId).maybeSingle());
  if (!winning) return err('Winning not found', 404);
  const draw = must(await supabase().from(T('draws')).select('*').eq('id', winning.draw_id).single());
  const members = selectBroadcastAudience(must(await supabase().from(T('members')).select('*')));
  let emailed = 0;
  for (const m of members) {
    const tpl = announceWinEmail({
      memberName: m.name, drawDate: draw.draw_date, division: winning.division,
      amountCents: winning.amount_cents, addedToKitty: winning.added_to_kitty,
    });
    const { sent } = await sendEmail({
      ...tpl, to: m.email, type: 'announce_win', memberId: m.id, drawId: draw.id,
    });
    if (sent) emailed++;
  }
  return json({ emailed });
}

async function adminSettings(session, req) {
  if (req.method === 'GET') {
    const s = await getSettings();
    return json({
      weekly_charge_cents: s.weekly_charge_cents,
      charge_on_publish: s.charge_on_publish,
      owing_threshold_cents: s.owing_threshold_cents,
    });
  }
  const body = await readBody(req);
  const patch = {};
  if (body.weekly_charge_cents !== undefined) {
    const v = validateCents(body.weekly_charge_cents);
    if (v === null) return err('Invalid weekly_charge_cents');
    patch.weekly_charge_cents = v;
  }
  if (body.charge_on_publish !== undefined) {
    if (typeof body.charge_on_publish !== 'boolean') return err('charge_on_publish must be boolean');
    patch.charge_on_publish = body.charge_on_publish;
  }
  if (body.owing_threshold_cents !== undefined) {
    const v = validateCents(body.owing_threshold_cents, { allowNegative: true });
    if (v === null) return err('Invalid owing_threshold_cents');
    patch.owing_threshold_cents = v;
  }
  if (Object.keys(patch).length === 0) return err('Nothing to update');
  patch.updated_at = new Date().toISOString();
  must(await supabase().from(T('settings')).update(patch).eq('id', 1).select().single());
  await auditLog({ actorId: session.memberId, action: 'settings_updated', entity: 'settings', details: patch });
  return json({ ok: true });
}

async function adminRunReminders() {
  const summary = await runReminders();
  return json(summary);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, '');
  const method = req.method;

  try {
    // Public routes
    if (path === '/api/login' && method === 'POST') return await handleLogin(req);
    if (path === '/api/set-password' && method === 'POST') return await handleSetPassword(req);
    if (path === '/api/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    // Everything else requires a valid signed session AND a live, active
    // member row — deactivating a member kills their existing sessions.
    const session = sessionFromRequest(req);
    if (!session) return err('Not authenticated', 401);
    const live = must(
      await supabase().from(T('members')).select('role, is_active').eq('id', session.memberId).maybeSingle()
    );
    if (!live || !live.is_active) {
      return json({ error: 'Not authenticated' }, 401, { 'Set-Cookie': clearSessionCookie() });
    }

    if (path === '/api/me' && method === 'GET') return await handleMe(session);
    if (path === '/api/home' && method === 'GET') return await handleHome(session);
    if (path === '/api/history' && method === 'GET') return await handleHistory();
    if (path === '/api/account' && method === 'GET') return await handleAccount(session);
    if (path === '/api/account/notifications' && method === 'POST') return await handleNotificationsToggle(session, req);

    // Admin routes: role verified server-side from the signed token on every
    // request, AND re-checked against the live member row (so a demoted or
    // deactivated admin loses access immediately).
    if (path.startsWith('/api/admin/')) {
      if (session.role !== 'admin' || live.role !== 'admin') return err('Admin access required', 403);

      if (path === '/api/admin/overview' && method === 'GET') return await adminOverview();
      if (path === '/api/admin/members' && method === 'POST') return await adminCreateMember(session, req);
      const memberMatch = path.match(/^\/api\/admin\/members\/([^/]+)$/);
      if (memberMatch && method === 'PATCH') return await adminUpdateMember(session, req, memberMatch[1]);
      const inviteMatch = path.match(/^\/api\/admin\/members\/([^/]+)\/invite$/);
      if (inviteMatch && method === 'POST') return await adminSendInvite(session, inviteMatch[1]);
      if (path === '/api/admin/draws' && method === 'POST') return await adminCreateDraw(session, req);
      if (path === '/api/admin/tickets' && method === 'POST') return await adminSaveTicket(session, req);
      const publishMatch = path.match(/^\/api\/admin\/tickets\/([^/]+)\/publish$/);
      if (publishMatch && method === 'POST') return await adminPublishTicket(session, req, publishMatch[1]);
      if (path === '/api/admin/results' && method === 'POST') return await adminEnterResults(session, req);
      if (path === '/api/admin/payments' && method === 'POST') return await adminRecordPayment(session, req);
      if (path === '/api/admin/adjustments' && method === 'POST') return await adminAdjustment(session, req);
      if (path === '/api/admin/winnings' && method === 'POST') return await adminConfirmWinnings(session, req);
      if (path === '/api/admin/winnings/announce' && method === 'POST') return await adminAnnounceWin(session, req);
      if (path === '/api/admin/settings' && (method === 'GET' || method === 'PATCH')) return await adminSettings(session, req);
      if (path === '/api/admin/reminders/run' && method === 'POST') return await adminRunReminders();
    }

    return err('Not found', 404);
  } catch (e) {
    console.error(`API error ${method} ${path}:`, e);
    return err('Something went wrong', 500);
  }
}
