import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Set DIRECT_URL or DATABASE_URL before running the migration.');
}

const {Client} = pg;
const client = new Client({connectionString});

try {
  await client.connect();
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await client.query(sql);
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`Migration complete. ${result.rowCount} public tables are available.`);
} finally {
  await client.end();
}
