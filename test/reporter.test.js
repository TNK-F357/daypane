import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/reporter.js';

// runtime-data 是公开分支：推上去的内容里不能出现本机身份标识。
const sample = {
  ts: 1,
  host: 'SHEN-PC',
  quotas: { workbuddy: { ok: true, title: '客户A项目', model: 'hy3' } }
};

test('redact clears the machine name and the session title', () => {
  const out = redact(sample, {});
  assert.equal(out.host, '', 'machine name must never reach the public branch');
  assert.equal(out.quotas.workbuddy.title, '');
  assert.equal(out.quotas.workbuddy.model, 'hy3', 'metrics must survive redaction');
});

test('keepTitle keeps the title but never the machine name', () => {
  const out = redact(sample, { keepTitle: true });
  assert.equal(out.quotas.workbuddy.title, '客户A项目');
  assert.equal(out.host, '', 'REPORT_KEEP_TITLE must not re-enable the machine name');
});

test('redact does not mutate the source object', () => {
  const src = { ts: 1, host: 'X', quotas: { workbuddy: { title: 'T' } } };
  redact(src, {});
  assert.equal(src.host, 'X');
  assert.equal(src.quotas.workbuddy.title, 'T');
});
