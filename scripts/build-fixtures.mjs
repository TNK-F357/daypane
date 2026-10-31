// Generates the fixture SQLite databases used by the test suite.
// Run automatically via `npm run pretest` (before `npm test`).
//
// NOTE: this script MUST live outside test/ because `node --test`
// treats every .js/.mjs under test/ as a test file and would run it
// concurrently with db.test.js, racing the DB delete/recreate.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'test', 'fixtures');
const MAIN = join(FIXTURES, 'workbuddy.db');
const EMPTY = join(FIXTURES, 'empty.db');

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      title TEXT,
      status TEXT,
      model TEXT,
      last_activity_at INTEGER,
      deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS session_usage (
      session_id TEXT,
      used INTEGER,
      size INTEGER,
      updated_at INTEGER,
      credit_json TEXT
    );
  `);
}

function build(path, rows) {
  try {
    unlinkSync(path);
    unlinkSync(path + '-wal');
    unlinkSync(path + '-shm');
  } catch {
    /* not exists */
  }
  const db = new Database(path);
  // Guarantee a clean slate even if the file was locked and not deleted.
  db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS session_usage;');
  schema(db);

  const insS = db.prepare(
    'INSERT INTO sessions (id, cwd, title, status, model, last_activity_at, deleted_at) VALUES (?,?,?,?,?,?,?)'
  );
  const insU = db.prepare(
    'INSERT INTO session_usage (session_id, used, size, updated_at, credit_json) VALUES (?,?,?,?,?)'
  );

  const insertSession = db.transaction((list) => {
    for (const r of list) {
      insS.run(
        r.id,
        r.cwd,
        r.title,
        r.status,
        r.model ?? null,
        r.last_activity_at,
        r.deleted_at ?? null
      );
      if (r.usage) {
        insU.run(r.id, r.usage.used, r.usage.size, r.usage.updated_at, r.usage.credit_json ?? null);
      }
    }
  });
  insertSession(rows);
  db.close();
}

// Deterministic fixture:
//  - s1 / s2 live in the same workspace; s2 is newest and has usage (used 100 / size 1000)
//  - s3 is in another cwd and has NO usage row (exercises the fallback path)
//  - credit_json 形如 { requestId: credit }，供 creditUsed/creditCount 断言
const fixtureRows = [
  {
    id: 's1',
    cwd: 'C:\\Users\\Shen\\WorkBuddy\\ws',
    title: 'A',
    status: 'planning',
    model: 'hy3',
    last_activity_at: 1000,
    usage: { used: 50, size: 1000, updated_at: 1000, credit_json: '{"a":1.5,"b":2.5}' }
  },
  {
    id: 's2',
    cwd: 'C:\\Users\\Shen\\WorkBuddy\\ws',
    title: 'B',
    status: 'completed',
    model: 'hy3',
    last_activity_at: 2000,
    usage: { used: 100, size: 1000, updated_at: 2000, credit_json: '{"c":10,"d":0.5}' }
  },
  {
    id: 's3',
    cwd: 'C:\\other\\path',
    title: 'C',
    status: 'active',
    model: 'gpt',
    last_activity_at: 500
  }
];

mkdirSync(FIXTURES, { recursive: true });
build(MAIN, fixtureRows);
build(EMPTY, []);
console.log('fixtures built:', MAIN, EMPTY);
