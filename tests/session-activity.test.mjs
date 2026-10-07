import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../session-activity.js', import.meta.url), 'utf8');
function fixture() {
  let now = 1000, tick, sends = 0, expired = 0, fail = false, elapsed = null;
  const handlers = {}, doc = { visibilityState: 'visible', addEventListener: (n, fn) => handlers[n] = fn };
  const ctx = {}; vm.runInNewContext(source, ctx);
  const activity = ctx.createPortalActivity({ now: () => now, document: doc, channel: null,
    every: fn => { tick = fn; return 1; }, cancel: () => {}, expired: () => expired++,
    send: async (value = {}) => { sends++; elapsed = value.elapsedMs ?? 0; if (fail) throw new Error('offline'); return { idleExpiresAt: now + 1200000 - elapsed, sessionExpiresAt: 43201000 }; }
  });
  activity.start({ profile: { id: 'self' }, idleExpiresAt: now + 1200000, sessionExpiresAt: 43201000 });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { activity, handlers, doc, flush, advance: async ms => { now += ms; tick(); await flush(); },
    event: async (name, trusted = true, details = {}) => { handlers[name]?.({ isTrusted: trusted, ...details }); await flush(); },
    get sends() { return sends; }, get expired() { return expired; }, get elapsed() { return elapsed; }, fail: () => fail = true };
}
test('background timers, visibility changes and scripted events never prolong inactivity', async () => {
  const f = fixture();
  await f.event('pointermove', false); await f.event('visibilitychange');
  await f.advance(19 * 60000); assert.equal(f.sends, 0); assert.equal(f.expired, 0);
  await f.advance(60000); assert.equal(f.expired, 1);
});
test('trusted typing/clicking/scrolling extends work; event flood is throttled', async () => {
  const f = fixture(); await f.advance(19 * 60000); await f.event('input');
  assert.equal(f.sends, 1);
  for (let i = 0; i < 100; i++) await f.event('keydown');
  assert.equal(f.sends, 1);
  await f.advance(60000); assert.equal(f.sends, 2);
  await f.advance(18 * 60000); assert.equal(f.expired, 0);
  await f.advance(60000); assert.equal(f.expired, 1);
});
test('browser-generated scroll and hovering never keep an unattended page alive', async () => {
  const f = fixture();
  for (let i = 0; i < 240; i++) {
    await f.event('scroll'); await f.event('pointermove');
    await f.advance(5000);
  }
  assert.equal(f.sends, 0);
  assert.equal(f.expired, 1);
});
test('queued input expires twenty minutes after the input, not its later timer flush', async () => {
  const f = fixture();
  await f.event('keydown');
  await f.advance(30000); await f.event('input');
  await f.advance(30000);
  assert.equal(f.sends, 2);
  assert.equal(f.elapsed, 30000);
  await f.advance(19 * 60000 + 30000);
  assert.equal(f.expired, 1);
});
test('wheel and deliberate dragging count as work without relying on scroll events', async () => {
  const f = fixture();
  await f.advance(19 * 60000); await f.event('wheel');
  await f.advance(19 * 60000); await f.event('pointermove', true, { buttons: 1 });
  assert.equal(f.sends, 2);
  assert.equal(f.expired, 0);
});
test('restoring legacy UI state never fabricates an activity request', async () => {
  const f = fixture();
  f.activity.start({ profile: { id: 'self' } });
  await f.flush(); await f.advance(60000);
  assert.equal(f.sends, 0);
});
test('waking an expired laptop cannot renew, hidden pages ignore input, offline does not extend', async () => {
  const f = fixture(); f.doc.visibilityState = 'hidden'; await f.event('input');
  assert.equal(f.sends, 0);
  f.doc.visibilityState = 'visible'; f.fail(); await f.event('input');
  assert.equal(f.sends, 1);
  await f.advance(20 * 60000); assert.equal(f.expired, 1);
  await f.event('input'); assert.equal(f.sends, 1);
});
