require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const {
  RESTORE_CONFIRMATION,
  listBackups,
  restoreTestEnvironment,
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
    backupId: values['backup-id'] || '',
    confirmation: values.confirm || '',
  };
}

async function main() {
  const args = parseArgs();
  await connectDB();
  const db = mongoose.connection.db;

  if (!args.backupId) {
    const backups = await listBackups(db, 10);
    console.log('Informe --backup-id. Backups recentes:');
    for (const item of backups) {
      console.log(`- ${item.id} | ${item.status} | ${item.createdAt.toISOString()}`);
    }
    return;
  }

  const backups = await listBackups(db, 50);
  const selected = backups.find((item) => item.id === args.backupId);
  if (!selected) throw new Error('Backup não encontrado entre os backups recentes.');

  console.log(`Backup: ${selected.id}`);
  console.log(`Criado em: ${selected.createdAt.toISOString()}`);
  console.log(`Status: ${selected.status}`);

  if (!args.apply) {
    console.log(
      `\nPara restaurar: node scripts/restore-test-environment.js --backup-id=${selected.id} --apply --confirm=${RESTORE_CONFIRMATION}`
    );
    return;
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_RESET !== 'YES') {
    throw new Error(
      'Em NODE_ENV=production, defina ALLOW_TEST_RESET=YES somente durante esta execução.'
    );
  }

  await restoreTestEnvironment(db, {
    backupId: args.backupId,
    confirmation: args.confirmation,
    actorUserId: 'CLI',
  });

  console.log('\n✅ Backup restaurado.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`\n❌ Restauração não concluída: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = { parseArgs };
