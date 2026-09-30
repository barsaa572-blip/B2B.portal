import { randomUUID } from 'node:crypto';

export function createRefundQuotes() {
  const entries = new Map();
  return {
    save(actor, pnr, quote, now = Date.now()) {
      for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
      if (entries.size >= 1000) entries.delete(entries.keys().next().value);
      const id = randomUUID();
      entries.set(id, { actor, pnr, quote: structuredClone(quote), expiresAt: now + 600000 });
      return id;
    },
    take(id, actor, pnr, now = Date.now()) {
      const entry = entries.get(id);
      if (!entry || entry.actor !== actor || entry.pnr !== pnr || entry.expiresAt <= now) throw new Error('Please calculate and review the refund again.');
      entries.delete(id);
      return structuredClone(entry.quote);
    }
  };
}
