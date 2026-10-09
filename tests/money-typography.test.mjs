import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('money typography overrides load after theme and legacy label styles',()=>{
  const index=read('index.html'),css=read('money-display.css');
  assert.ok(index.indexOf('money-display.css')>index.indexOf('nexahub-brand.css'));
  assert.match(css,/\.money-value\[data-money-cny\]\{[^}]*font:inherit;[^}]*color:inherit/);
  assert.match(css,/html\[data-theme="dark"\] \.money-value\[data-money-cny\]\{color:inherit\}/);
  for(const selector of ['.flight .fare .passenger-price>strong','.pair-footer .passenger-price>strong','.fare-family-price .passenger-price>strong'])assert.ok(css.includes(selector));
  assert.match(css,/font-size:20px;font-weight:600/);
  assert.match(css,/font-size:18px/);
  assert.doesNotMatch(css,/font-weight:800|font-size:24px/);
  assert.doesNotMatch(css,/!important/);
});

test('top-up secondary MNT figures are readable without overwhelming CNY totals',()=>{
  const css=read('styles.css');
  assert.match(css,/#topup-rate-preview small\{[^}]*font-size:13px;font-weight:500;color:var\(--ink\)/);
  assert.match(css,/#topup-rate-preview \.funding-total>small\{font-size:14px\}/);
  assert.match(css,/#topup-rate-preview \.funding-total>strong\{font-size:20px;font-weight:600/);
});

test('high-specificity dark fare label group excludes currency values',()=>{
  const css=read('night-theme.css');
  assert.match(css,/\.fare-family-price span:not\(\[data-money-cny\]\)/);
  assert.doesNotMatch(css,/\.fare-family-price span\s*[,)]/);
});
