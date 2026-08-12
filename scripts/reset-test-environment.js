require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const {
  RESET_CONFIRMATION,
  collectPreview,
  resetTestEnvironment,
} = require('../services/testEnvironmentReset');

function parseArgs(argv = process.argv.slice(2)) {
  const values = Object.fromEntries(
    argv
      .filter((item) => item.startsWith('--') && item.includes('='))
      .map((item) => {
        const index = item.indexOf('=');
        return [item.slice(2, index), item.slice(index + 1)];
      })
  );

  return {
    apply: argv.includes('--apply'),
    confirmation: values.confirm || '',
  };
}

function printPreview(preview, applying) {
  console.log('\n=== RESET DO AMBIENTE DE TESTES ===');
  console.log(`Modo: ${applying ? 'APLICAÇÃO' : 'PRÉVIA (nenhuma alteração)'}`);
  console.log(`Banco: ${preview.database}`);
  console.log(`Contas humanas: ${preview.humanUsers}`);
  console.log(`Contas institucionais: ${preview.institutionalUsers}`);
  console.log(`Clubes: ${preview.clubs}`);
  console.log(
    `Temporada ativa: ${preview.season ? `${preview.season.nome} (${preview.season.codigo})` : 'nenhuma'}`
  );
  console.log(`Pagamentos pendentes/processando: ${preview.pendingPayments}`);
}

async function main() {
  const args = parseArgs();
  await connectDB();
  const db = mongoose.connection.db;
  const preview = await collectPreview(db);
  printPreview(preview, args.apply);

  if (!args.apply) {
    console.log(
      `\nPara aplicar: node scripts/reset-test-environment.js --apply --confirm=${RESET_CONFIRMATION}`
    );
    return;
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_RESET !== 'YES') {
    throw new Error(
      'Em NODE_ENV=production, defina ALLOW_TEST_RESET=YES somente durante esta execução.'
    );
  }

  const result = await resetTestEnvironment(db, {
    confirmation: args.confirmation,
    actorUserId: 'CLI',
  });

  console.log('\n✅ Reset concluído e verificado.');
  console.log(`Backup para restauração: ${result.backupId}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`\n❌ Reset não concluído: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = { parseArgs };
