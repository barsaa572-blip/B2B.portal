// Shared display arithmetic. Never derive a payment from formatted text.
(() => {
  const integer = (value, places, label) => {
    if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || String(value).length > 24 || !new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(String(value))) throw new Error(`Invalid ${label}.`);
    const [whole, fraction = ''] = String(value).split('.');
    return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  };
  const roundMnt = (amount, rate, direction = 'charge', step = 10) => {
    if (!['charge', 'refund'].includes(direction) || ![10, 100].includes(step)) throw new Error('Invalid display rounding.');
    const r = integer(rate, 6, 'exchange rate');
    if (r <= 0n) throw new Error('Invalid exchange rate.');
    const numerator = integer(amount, 2, 'CNY amount') * r;
    const block = BigInt(step) * 100n * 1_000_000n;
    const result = Number((direction === 'refund' ? numerator / block : (numerator + block - 1n) / block) * BigInt(step));
    if (!Number.isSafeInteger(result)) throw new Error('Display amount is too large.');
    return result;
  };
  const cny = value => `¥ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mnt = value => `₮ ${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const core = { integer, roundMnt, cny, mnt };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;
  let currency = 'MNT', officialRate = null;
  try { if (localStorage.getItem('nexahub-display-currency') === 'CNY') currency = 'CNY'; } catch {}
  const text = (value, { rate = officialRate, direction = 'charge', savedMnt = null } = {}) => {
    try {
      integer(value, 2, 'CNY amount');
      if (currency === 'CNY') return cny(value);
      return savedMnt != null ? mnt(savedMnt) : rate ? mnt(roundMnt(value, rate, direction)) : 'Rate unavailable';
    } catch { return '—'; }
  };
  const markupCny = (value, options = {}) => {
    try { integer(value, 2, 'CNY amount'); } catch { return '—'; }
    const attrs = [`data-money-cny="${Number(value).toFixed(2)}"`, `data-money-direction="${options.direction === 'refund' ? 'refund' : 'charge'}"`];
    if (options.rate != null) {
      try { integer(options.rate, 6, 'exchange rate'); } catch { return '—'; }
      attrs.push(`data-money-rate="${Number(options.rate)}"`);
    }
    if (options.savedMnt != null && Number.isSafeInteger(options.savedMnt) && options.savedMnt >= 0) attrs.push(`data-money-mnt="${options.savedMnt}"`);
    return `<span ${attrs.join(' ')}>${text(value, options)}</span>`;
  };
  const refresh = root => {
    const targets = [...(root.querySelectorAll?.('[data-money-cny]') || [])];
    if (root.matches?.('[data-money-cny]')) targets.unshift(root);
    for (const el of targets) {
      const value = text(el.dataset.moneyCny, { rate: el.dataset.moneyRate || officialRate, direction: el.dataset.moneyDirection || 'charge', savedMnt: el.dataset.moneyMnt == null ? null : Number(el.dataset.moneyMnt) });
      if (el.textContent !== value) el.textContent = value;
    }
  };
  const setCurrency = value => {
    if (!['CNY', 'MNT'].includes(value)) return;
    currency = value;
    try { localStorage.setItem('nexahub-display-currency', currency); } catch {}
    document.documentElement.dataset.displayCurrency = currency;
    document.querySelectorAll('[data-currency-selector]').forEach(el => { el.value = currency; });
    document.querySelectorAll('[data-currency-heading]').forEach(el => { el.textContent = `${el.dataset.currencyHeading} (${currency})`; });
    refresh(document);
  };
  globalThis.PortalMoney = { ...core, text, markupCny, refresh, setCurrency, getCurrency: () => currency,
    setRate: rate => { try { integer(rate, 6, 'exchange rate'); if (Number(rate) <= 0) return; officialRate = Number(rate); refresh(document); } catch {} }
  };
  document.addEventListener('change', event => { if (event.target.matches?.('[data-currency-selector]')) setCurrency(event.target.value); });
  setCurrency(currency);
  new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) refresh(node); }).observe(document.body, { subtree: true, childList: true });
})();
