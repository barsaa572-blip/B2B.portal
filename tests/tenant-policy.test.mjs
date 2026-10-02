import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural regression only; apply and verify against live Supabase separately.
test('tenant migration adds restrictive authenticated gates without broadening grants', () => {
  const sql = readFileSync(new URL('../supabase/tenant-access-hardening.sql', import.meta.url), 'utf8').replace(/^\s*--.*$/gm, '');
  assert.match(sql, /\bbegin;/i);
  assert.match(sql, /\bcommit;/i);
  assert.match(sql, /c\.relrowsecurity/);
  for (const table of ['bookings', 'topup_requests']) {
    assert.match(sql, new RegExp(`create policy "portal current agency boundary" on public\\.${table}\\s+as restrictive for select to authenticated\\s+using \\(public\\.is_platform_admin\\(\\) or agency_id = public\\.current_agency_id\\(\\)\\);`, 'i'));
  }
  assert.doesNotMatch(sql, /\b(grant|disable row level security|truncate)\b/i);
  assert.doesNotMatch(sql, /drop policy[^;]+"(agency isolation|agent own bookings|topup request isolation|active portal readers only)"/i);
});
