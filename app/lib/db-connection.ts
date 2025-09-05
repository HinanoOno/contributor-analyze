import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_FILE = './repository_cache.sqlite';

let dbInstance: Database | null = null;

export async function getDbConnection(): Promise<Database> {
  if (!dbInstance) {
    console.log('🔌 Creating new shared database connection...');
    try {
      dbInstance = await open({
        filename: DB_FILE,
        driver: sqlite3.Database,
      });

      console.log('✅ Shared database connection established.');
    } catch (error) {
      console.error('Failed to open database connection:', error);
      throw error;
    }
  }
  return dbInstance;
}

export async function closeDbConnection(): Promise<void> {
  if (dbInstance) {
    console.log('🔒 Closing shared database connection...');
    try {
      await dbInstance.close();
      dbInstance = null;
      console.log('✅ Shared database connection closed.');
    } catch (error) {
      console.error('Failed to close database connection:', error);
      throw error;
    }
  }
}
