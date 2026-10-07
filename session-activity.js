(() => {
  // Human input only. Timers, supplier polling and token refresh never renew idle time.
  globalThis.createPortalActivity = ({ send, expired, changed = () => {},
    now = Date.now, document: doc = globalThis.document,
    every = setInterval, cancel = clearInterval,
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nexahub-activity') : null } = {}) => {
    let running = false, idleAt = 0, absoluteAt = 0, userId, timer;
    let dirty = false, lastSend = 0, lastInput = 0, busy = false, generation = 0;
    const bounds = value => {
      if (!Number.isFinite(value?.idleExpiresAt) || !Number.isFinite(value?.sessionExpiresAt)) return;
      idleAt = Math.min(value.idleExpiresAt, value.sessionExpiresAt);
      absoluteAt = value.sessionExpiresAt;
      changed({ idleExpiresAt: idleAt, sessionExpiresAt: absoluteAt });
    };
    const stop = () => { running = false; generation++; cancel(timer); timer = null; dirty = false; busy = false; };
    const expire = () => { stop(); expired('Your session expired after inactivity. Sign in again.'); };
    const tick = async () => {
      if (!running) return;
      // Even a real event after a suspended laptop wakes cannot revive an expired session.
      if (now() >= idleAt || now() >= absoluteAt) { expire(); return; }
      if (!dirty || busy || now() - lastSend < 60000) return;
      const current = generation;
      busy = true; dirty = false; lastSend = now();
      try {
        // A queued event must not gain another minute of lifetime when flushed.
        const value = await send({ elapsedMs: Math.max(0, Math.floor(now() - lastInput)) });
        if (!running || generation !== current) return;
        bounds(value);
        channel?.postMessage({ userId, idleExpiresAt: idleAt, sessionExpiresAt: absoluteAt });
      } catch (error) {
        if (!running || generation !== current) return;
        if (error.status === 401 || error.status === 403) expire();
        else dirty = true; // Offline/timeouts never fabricate a server extension.
      } finally { if (generation === current) busy = false; }
    };
    const input = event => {
      if (!running || event.isTrusted !== true || doc.visibilityState === 'hidden') return;
      // Hovering is not work. Dragging, wheel input, typing and clicks are.
      if (event.type === 'pointermove' && !(event.buttons > 0)) return;
      lastInput = now();
      dirty = true; void tick();
    };
    // scroll can be emitted by programmatic focus/scrolling and DOM updates.
    // Observe its physical causes instead, never the generated scroll event.
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel']) {
      doc.addEventListener(type, event => input({ type, isTrusted: event.isTrusted, buttons: event.buttons }), { passive: true, capture: true });
    }
    doc.addEventListener('visibilitychange', () => { void tick(); }); // Not activity.
    if (channel) channel.onmessage = event => {
      if (running && event.data?.userId === userId
        && event.data.sessionExpiresAt === absoluteAt && event.data.idleExpiresAt > idleAt) bounds(event.data);
    };
    return {
      start(value) {
        stop(); userId = value.profile?.id; generation++;
        // auth.js validates restored cookies first; fallback bounds are local only.
        idleAt = Number(value.idleExpiresAt || now() + 1200000);
        absoluteAt = Number(value.sessionExpiresAt || now() + 12 * 3600000);
        // Restoring a page is not human activity and must never touch the server.
        running = true; dirty = false; lastInput = now(); lastSend = -Infinity;
        timer = every(() => { void tick(); }, 1000); void tick();
        return running;
      }, stop, update: bounds
    };
  };
})();
