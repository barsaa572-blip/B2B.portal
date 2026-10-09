import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('retired wallet reset has an inert invoker body and no API execution grants', async () => {
  const sql = await readFile(new URL('../supabase/wallet-funding-controls.sql', import.meta.url), 'utf8');
  const reset = sql.slice(sql.indexOf('create or replace function public.platform_reset_all_wallets'), sql.indexOf('-- Checks funds only.'));
  assert.match(reset, /security invoker set search_path = ''/);
  assert.match(reset, /raise exception using errcode = '42501', message = 'WALLET_RESET_DISABLED'/);
  assert.doesNotMatch(reset, /\b(delete|update|insert|truncate|execute|perform)\b/i);
  assert.match(reset, /revoke all on function public\.platform_reset_all_wallets\(uuid\)\s+from public, anon, authenticated, service_role/);
  const hardening = await readFile(new URL('../supabase/security-hardening.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(hardening, /'platform_reset_all_wallets'/);
  assert.match(hardening, /revoke all on function public\.platform_reset_all_wallets\(uuid\)\s+from public, anon, authenticated, service_role/);
});

test('backend has no wallet reset RPC caller or destructive confirmation flow', async () => {
  for (const file of ['server.mjs', 'backend/supabase-client.mjs']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /clearAllWalletBalancesAndHistory|rpc\/platform_reset_all_wallets|RESET WALLETS/);
  }
});
