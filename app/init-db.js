import { initializeDatabase } from './lib/db.ts';

async function runInit() {
  try {
    console.log('Starting database initialization...');
    await initializeDatabase();
    console.log('Database initialization finished successfully.');
    process.exit(0); // 成功時にプロセスを終了
  } catch (err) {
    console.error('Database initialization script failed:', err);
    process.exit(1); // 失敗時にエラーコードで終了
  }
}

runInit();
