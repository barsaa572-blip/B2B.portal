import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.js', import.meta.url), 'utf8');
test('admin forms avoid built-in name collisions and retain server DTO field names', () => {
  assert.doesNotMatch(admin, /name=["'](?:name|role)["']/);
  assert.match(admin, /name="agencyName"/);
  assert.match(admin, /name="accountRole"/);
  assert.match(admin, /name: agencyName/);
  assert.match(admin, /name: values\.get\('agencyName'\)/);
  assert.match(admin, /role: accountRole/);
  assert.match(admin, /role: new FormData\(form\)\.get\('accountRole'\)/);
});
