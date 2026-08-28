// Supabase access. Runs ONLY inside Netlify Functions with the service role
// key from Netlify environment variables — never shipped to the frontend.

import { createClient } from '@supabase/supabase-js';

let _client;

export function supabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

/** Throw-on-error helper for supabase-js responses. */
export function must({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

/**
 * Ledger adapter used by chargeMembersForDraw. Duplicate protection is the
 * database's partial unique index; Postgres error 23505 = duplicate, which we
 * treat as "already charged, skip".
 */
export function chargeDb() {
  return {
    async insertChargeIgnoringDuplicates(row) {
      const { error } = await supabase().from('transactions').insert(row);
      if (!error) return { inserted: true };
      if (error.code === '23505') return { inserted: false };
      throw new Error(error.message);
    },
  };
}

export async function memberBalanceCents(memberId) {
  const rows = must(
    await supabase().from('transactions').select('amount_cents').eq('member_id', memberId)
  );
  return rows.reduce((s, r) => s + r.amount_cents, 0);
}

/** Balances for many members in one query. Returns Map(member_id -> cents). */
export async function memberBalancesCents(memberIds) {
  const balances = new Map(memberIds.map((id) => [id, 0]));
  if (memberIds.length === 0) return balances;
  const rows = must(
    await supabase()
      .from('transactions')
      .select('member_id, amount_cents')
      .in('member_id', memberIds)
  );
  for (const r of rows) balances.set(r.member_id, (balances.get(r.member_id) ?? 0) + r.amount_cents);
  return balances;
}

export async function kittyBalanceCents() {
  const rows = must(await supabase().from('kitty_transactions').select('amount_cents'));
  return rows.reduce((s, r) => s + r.amount_cents, 0);
}

export async function getSettings() {
  return must(await supabase().from('settings').select('*').eq('id', 1).single());
}

export async function auditLog({ actorId = null, action, entity, entityId = null, details = null }) {
  await supabase().from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    details,
  });
}
