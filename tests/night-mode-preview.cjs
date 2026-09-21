// Local-only CSS QA harness. No credentials, supplier calls or financial writes.
// Run: node tests/night-mode-preview.cjs; open http://127.0.0.1:4181
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname.slice(1) || 'index.html';
  if (name.startsWith('api/')) {
    res.setHeader('content-type', 'application/json');
    if (name === 'api/flights/prices' || name === 'api/flights/price') {
      let input = '';
      req.on('data', chunk => input += chunk);
      req.on('end', () => {
        const body = JSON.parse(input);
        const price = { currency: 'CNY', total: 1510, breakdown: [
          { type: 'adults', count: 1, fare: 800, taxes: 200, total: 1000 },
          { type: 'children', count: 1, fare: 300, taxes: 200, total: 500 },
          { type: 'infants', count: 1, fare: 10, taxes: 0, total: 10 }
        ] };
        res.end(JSON.stringify(body.selections ? { results: body.selections.map(() => ({ price })) } : { ...price, quoteId: 'qa-only', expiresAt: Date.now() + 600000 }));
      });
      return;
    }
    if (name === 'api/fx/cny-mnt') return res.end(JSON.stringify({ effectiveRateMnt: 540.8, nonCashSellMnt: 540.8 }));
    if (name === 'api/admin/overview') return res.end(JSON.stringify({ agencies: [], profiles: [], branches: [], wallets: [], topups: [], statistics: {} }));
    if (req.method !== 'GET') { res.writeHead(403); return res.end('{"error":"QA: writes disabled"}'); }
    return res.end('[]');
  }
  if (!/^[a-z][a-z0-9.-]*\.(html|css|js|png)$/.test(name)) { res.writeHead(404); return res.end(); }
  try {
    let content = name === 'auth.js' ? readFileSync(path.join(__dirname, 'night-mode-fixture.js')) : readFileSync(path.join(root, name));
    res.setHeader('content-type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' })[path.extname(name)]);
    res.setHeader('cache-control', 'no-store'); res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(4181, '127.0.0.1', () => console.log('QA only: http://127.0.0.1:4181'));
