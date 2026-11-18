import pg from 'pg';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import * as seed from './seed.js';

try { process.loadEnvFile(); } catch {} // .env opsional; variabel lingkungan hosting tetap dipakai
pg.types.setTypeParser(1082, (v) => v); // kolom DATE tetap string 'YYYY-MM-DD'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi (lihat .env.example)');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);

export const hashPassword = (pw) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`; };
export const checkPassword = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(pw, salt, 64));
};

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id serial PRIMARY KEY,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('harian','bulanan','triwulan','semester','tahunan','kondisional')),
  target int NOT NULL DEFAULT 1 CHECK (target BETWEEN 1 AND 50),
  start_date date NOT NULL DEFAULT '2026-01-01',
  description text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT '',
  output text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holidays (
  date date PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
  id serial PRIMARY KEY,
  activity_id int NOT NULL REFERENCES activities ON DELETE CASCADE,
  done_date date NOT NULL,
  note text NOT NULL DEFAULT '',
  user_id int REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checks_activity_date ON checks (activity_id, done_date);
CREATE TABLE IF NOT EXISTS attachments (
  id serial PRIMARY KEY,
  check_id int NOT NULL REFERENCES checks ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_check ON attachments (check_id);
`;

export async function init() {
  await q(schema);
  if ((await q('SELECT 1 FROM activities LIMIT 1')).rowCount === 0) {
    for (const a of seed.activities)
      await q('INSERT INTO activities (name, frequency, target, description, plan, output, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [a.name, a.frequency, a.target, a.description, a.plan, a.output, a.outcome]);
    for (const [date, name] of seed.holidays)
      await q('INSERT INTO holidays (date, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [date, name]);
  }
  const { INIT_USERNAME: u, INIT_PASSWORD: p, INIT_NAME: n } = process.env;
  if (u && p && (await q('SELECT 1 FROM users LIMIT 1')).rowCount === 0) {
    await q('INSERT INTO users (username, name, password_hash) VALUES ($1,$2,$3)', [u.toLowerCase(), n || u, hashPassword(p)]);
    console.log(`Akun pertama "${u}" dibuat.`);
  }
}
