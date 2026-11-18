// Hanya untuk pengujian di komputer sendiri: menjalankan PostgreSQL bawaan npm lalu server aplikasi.
// Di hosting cukup `npm start` dengan DATABASE_URL ke PostgreSQL sungguhan.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = './.pgdata';
const pg = new EmbeddedPostgres({
  databaseDir: dir, user: 'postgres', password: 'postgres', port: 5433, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
if (!existsSync(dir)) await pg.initialise();
await pg.start();
await pg.createDatabase('manper').catch(() => {}); // sudah ada

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5433/manper';
process.env.DATABASE_URL_UNPOOLED ||= process.env.DATABASE_URL;
process.env.INIT_USERNAME ||= 'admin';
process.env.INIT_PASSWORD ||= 'admin12345';
process.env.INIT_NAME ||= 'Administrator';

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await import('./server.js');
