import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, formatStatus } from '../src/status.js';

test('computes remaining and percent for normal usage', () => {
  const s = computeStatus({ used: 100, size: 1000, model: 'hy3' });
  assert.equal(s.token.remaining, 900);
  assert.equal(s.token.percent, 10);
  assert.equal(s.model, 'hy3');
});

test('clamps percent to 100 when used exceeds size', () => {
  const s = computeStatus({ used: 1200, size: 1000, model: 'x' });
  assert.equal(s.token.remaining, 0);
  assert.equal(s.token.percent, 100);
});

test('handles size 0 without producing NaN', () => {
  const s = computeStatus({ used: 0, size: 0, model: 'x' });
  assert.equal(s.token.percent, null);
  assert.equal(s.token.remaining, null);
});

test('defaults model to unknown when missing', () => {
  const s = computeStatus({});
  assert.equal(s.model, 'unknown');
});

test('parses credit_json when present', () => {
  const s = computeStatus({ used: 1, size: 2, model: 'x', credit_json: '{"a":1}' });
  assert.deepEqual(s.credit, { a: 1 });
});

test('ignores malformed credit_json', () => {
  const s = computeStatus({ used: 1, size: 2, model: 'x', credit_json: 'not json' });
  assert.equal(s.credit, null);
});

test('sums credit_json into creditUsed / creditCount', () => {
  const s = computeStatus({ used: 10, size: 100, credit_json: '{"a":1.5,"b":2.25,"c":"skip"}' });
  assert.equal(s.creditUsed, 3.75);
  assert.equal(s.creditCount, 2); // 非数字值被过滤
});

test('creditUsed is null when credit_json is absent or malformed', () => {
  assert.equal(computeStatus({ used: 1, size: 2 }).creditUsed, null);
  assert.equal(computeStatus({ used: 1, size: 2, credit_json: 'nope' }).creditUsed, null);
  assert.equal(computeStatus({ used: 1, size: 2, credit_json: '[1,2]' }).creditUsed, null);
});

test('marks stale when usage is older than staleAfterMs', () => {
  const old = computeStatus({ used: 1, size: 2, updatedAt: 1000, staleAfterMs: 5000, now: 20000 });
  assert.equal(old.stale, true);
  const fresh = computeStatus({ used: 1, size: 2, updatedAt: 19000, staleAfterMs: 5000, now: 20000 });
  assert.equal(fresh.stale, false);
  // 没有 updatedAt 或没配 staleAfterMs 时不猜
  assert.equal(computeStatus({ used: 1, size: 2 }).stale, false);
});

test('context is the same numbers as the legacy token field', () => {
  const s = computeStatus({ used: 250, size: 1000, model: 'hy3' });
  assert.deepEqual(s.context, { used: 250, size: 1000, remaining: 750, percent: 25 });
  assert.equal(s.context, s.token); // 同一个引用：别再往 token 里塞新语义
});

test('formatStatus renders a readable string', () => {
  const out = formatStatus(computeStatus({ used: 100, size: 1000, model: 'hy3', title: 't' }));
  assert.match(out, /model=hy3/);
  assert.match(out, /10%/);
});
