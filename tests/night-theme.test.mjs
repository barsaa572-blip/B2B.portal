import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../night-theme.css', import.meta.url), 'utf8');
test('night mode covers search counts, fare, checkout, rules and empty report surfaces', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const selector of ['.fare-choice-screen', '.fare-family-choice', '.fare-price-breakdown', '.review-itinerary', '.passenger-card', '.contact-card', '.order-summary', '.empty-state', '.split-date-control']) {
    assert.ok(rules.some(([, selectors, declarations]) => selectors.includes('html[data-theme="dark"]') && selectors.includes(selector) && declarations.includes('background:var(--night-surface)')), selector);
  }
  assert.ok(rules.some(([, selectors, declarations]) => selectors.includes('.counter output') && declarations.includes('color:var(--night-text)')));
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /night-theme\.css\?v=20260922-account/);
});
test('night text palette remains readable on both card backgrounds', () => {
  assert.match(css, /--night-surface:#20232b/);
  assert.match(css, /--night-raised:#303642/);
  const hex = name => css.match(new RegExp(`--night-${name}:(#[0-9a-f]{6})`))[1];
  const lum = value => value.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
  for (const fg of ['text','muted','link']) for (const bg of ['surface','raised']) {
    const a=lum(hex(fg)), b=lum(hex(bg));
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5, `${fg} on ${bg}`);
  }
});
