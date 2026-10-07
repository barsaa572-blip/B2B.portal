(() => {
  // Human input only. Timers, supplier polling and token refresh never renew idle time.
  globalThis.createPortalActivity = ({ send, expired, changed = () => {},
    now = Date.now, document: doc = globalThis.document,
    every = setInterval, cancel = clearInterval,
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nexahub-activity') : null } = {}) => {
    let running = false, idleAt = 0, absoluteAt = 0, userId, timer;
    let dirty = false, lastSend = 0, busy = false, generation = 0;
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
        const value = await send();
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
      dirty = true; void tick();
    };
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'scroll', 'wheel']) {
      doc.addEventListener(type, input, { passive: true, capture: true });
    }
    doc.addEventListener('visibilitychange', () => { void tick(); }); // Not activity.
    if (channel) channel.onmessage = event => {
      if (running && event.data?.userId === userId
        && event.data.sessionExpiresAt === absoluteAt && event.data.idleExpiresAt > idleAt) bounds(event.data);
    };
    return {
      start(value) {
        stop(); userId = value.profile?.id; generation++;
        // Old releases lack these bounds: perform a server check before trusting them.
        idleAt = Number(value.idleExpiresAt || now() + 1200000);
        absoluteAt = Number(value.sessionExpiresAt || now() + 12 * 3600000);
        running = true; dirty = !value.idleExpiresAt; lastSend = -Infinity;
        timer = every(() => { void tick(); }, 1000); void tick();
        return running;
      }, stop, update: bounds
    };
  };
})();
