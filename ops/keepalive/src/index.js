const TIMEOUT_MS = 20_000;

export async function ping(env) {
  const base = String(env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    return { ok: false, error: 'APP_URL belum diisi di wrangler.toml' };
  }

  const url = `${base}/api/health`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'DompetkuKeepalive/1.0' },
    });
    return { ok: res.ok, status: res.status, url, at: new Date().toISOString() };
  } catch (err) {
    return { ok: false, status: 0, url, error: err.message, at: new Date().toISOString() };
  }
}

export default {
  async fetch(_request, env) {
    const result = await ping(env);
    return Response.json(result, { status: result.ok ? 200 : 502 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env));
  },
};
