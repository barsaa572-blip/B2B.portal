import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPublicAsset } from '../backend/request-security.mjs';

test('NEXAHUB replaces visible legacy branding without changing session keys', () => {
  const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  for (const file of ['index.html', 'auth.js', 'server.mjs']) {
    assert.doesNotMatch(read(file), /Flight B2B|FLIGHT B2B/);
    assert.match(read(file), /NEXAHUB/);
  }
  assert.match(read('index.html'), /<title>NEXAHUB<\/title>/);
  assert.match(read('auth.js'), /flightb2b-session/);
  assert.equal(isPublicAsset('nexahub-logo.png'), true);
  assert.equal(isPublicAsset('nexahub-favicon.png'), true);
  assert.match(read('index.html'), /rel="icon" type="image\/png" href="\/nexahub-favicon\.png\?v=20260921"/);
  const favicon = readFileSync(new URL('../nexahub-favicon.png', import.meta.url));
  assert.equal(favicon.subarray(1, 4).toString(), 'PNG');
  assert.equal(isPublicAsset('private.png'), false);
  const png = readFileSync(new URL('../nexahub-logo.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 2172);
  assert.equal(png.readUInt32BE(20), 724);
  assert.match(read('index.html'), /flightmark-20260921/);
  assert.doesNotMatch(read('auth.js'), /Secure airline ticketing|Your access level is assigned|auth-permissions/);
});
