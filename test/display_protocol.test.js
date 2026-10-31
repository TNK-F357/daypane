import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

test('manifest identifies retrievable image bytes and selected language', async () => {
  const png = Buffer.alloc(33);
  png.writeUInt32BE(1072, 16); png.writeUInt32BE(1448, 20);
  let selected;
  const server = createServer({renderImage: async language => { selected = language; return png; }});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const manifest = await (await fetch(base + '/api/display?lang=en')).json();
    assert.equal(selected, 'en'); assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.width, 1072); assert.equal(manifest.height, 1448);
    assert.equal(manifest.sha256, createHash('sha256').update(png).digest('hex'));
    assert.deepEqual(Buffer.from(await (await fetch(base + manifest.image_url)).arrayBuffer()), png);
    assert.equal((await fetch(base + '/api/image/not-present.png')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('failed renderer returns unavailable instead of a successful manifest', async () => {
  const server = createServer({renderImage: async () => { throw new Error('offline'); }});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { assert.equal((await fetch('http://127.0.0.1:' + server.address().port + '/api/display')).status, 503); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('html dashboard declares INIT as reassignable', async () => {
  // refresh() 会执行 INIT = await r.json()。若声明成 const，浏览器每次自动刷新
  // 都会抛 TypeError 并被 catch 吞掉 —— 页面数字永远停在首次打开的那一刻。
  const server = createServer({renderImage: async () => Buffer.alloc(33)});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const html = await (await fetch('http://127.0.0.1:' + server.address().port + '/')).text();
    assert.match(html, /\blet\s+INIT\s*=/, 'INIT must be declared with let');
    assert.doesNotMatch(html, /\bconst\s+INIT\s*=/, 'INIT must not be declared with const');
    assert.match(html, /INIT\s*=\s*await\s+r\.json\(\)/, 'refresh() must reassign INIT');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
