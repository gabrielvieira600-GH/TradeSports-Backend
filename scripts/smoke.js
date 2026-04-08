// scripts/smoke.js
// CAMADA 7/8 — Smoke tests (sem frontend)
// Use:
//   export BASE_URL=http://localhost:4001
//   export USER_TOKEN=...
//   export ADMIN_TOKEN=...
//   node scripts/smoke.js
const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const USER_TOKEN = process.env.USER_TOKEN;

async function req(path, method = 'GET', token = null, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  return { status: res.status, json };
}

function assert(cond, msg, extra) {
  if (!cond) {
    console.error('FAIL:', msg, extra || '');
    process.exit(1);
  }
}

(async () => {
  const h = await req('/health');
  assert(h.status === 200 && h.json.ok === true, 'health failed', h);

  assert(USER_TOKEN, 'Defina USER_TOKEN no env');
  assert(ADMIN_TOKEN, 'Defina ADMIN_TOKEN no env');

  const d = await req('/deposito', 'POST', USER_TOKEN, { valor: 10 });
  assert(d.status === 200 && d.json.ok === true, 'deposito failed', d);

  const s = await req('/saque', 'POST', USER_TOKEN, { valor: 5 });
  assert(s.status === 200 && s.json.ok === true, 'saque failed', s);

  const st = await req('/admin/status', 'GET', ADMIN_TOKEN);
  assert(st.status === 200 && st.json.ok === true, 'admin status failed', st);

  console.log('OK ✅');
})();
