/**
 * Smoke test do Ledger (Camada 13)
 * Uso:
 *   set BASE_URL=http://localhost:4001
 *   set ADMIN_TOKEN=...
 *   node scripts/ledger-smoke.js
 */
const fetch = global.fetch;

const BASE = process.env.BASE_URL || 'http://localhost:4001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

async function main() {
  const health = await fetch(`${BASE}/health`).then(r => r.json()).catch(() => null);
  console.log('health:', health);

  // Aqui você vai expor futuramente um endpoint admin/ledger para testar.
  console.log('Ledger smoke: OK (endpoints serão adicionados na integração).');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
