import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../ops/keepalive/src/index.js';

test('worker memanggil /api/health pada APP_URL', async () => {
  const original = globalThis.fetch;
  let called = '';
  globalThis.fetch = async (url) => {
    called = String(url);
    return new Response('{"ok":true}', { status: 200 });
  };

  try {
    const res = await worker.fetch(new Request('https://keepalive.local/'), {
      APP_URL: 'https://dompetku.onrender.com/',
    });
    assert.equal(res.status, 200);
    assert.equal(called, 'https://dompetku.onrender.com/api/health');
    assert.equal((await res.json()).ok, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('worker membalas 502 bila APP_URL kosong', async () => {
  const res = await worker.fetch(new Request('https://keepalive.local/'), {});
  assert.equal(res.status, 502);
  assert.equal((await res.json()).ok, false);
});

test('worker membalas 502 bila target tidak bisa dihubungi', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };

  try {
    const res = await worker.fetch(new Request('https://keepalive.local/'), {
      APP_URL: 'https://dompetku.onrender.com',
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'network down');
  } finally {
    globalThis.fetch = original;
  }
});
