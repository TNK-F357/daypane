import Database from 'better-sqlite3';
import { computeStatus } from './status.js';
import { getConfig } from './config.js';

/**
 * Open WorkBuddy's local SQLite database in read-only mode.
 * Read-only avoids locking the live DB and prevents accidental writes.
 * @param {string} path
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(path) {
  return new Database(path, { readonly: true, fileMustExist: true });
}

/**
 * Close a previously opened database handle (safe to call repeatedly).
 * @param {import('better-sqlite3').Database} db
 */
export function closeDb(db) {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

/**
 * Read the normalized status for the user's most recent WorkBuddy session.
 *
 * Logic:
 *  - pick the session with the newest `last_activity_at` (optionally scoped by cwd)
 *  - read its token usage from `session_usage` via `session_id`
 *  - if that session has no usage row, fall back to the newest usage row,
 *    preferring the same cwd; the fallback ALSO carries the model/title of the
 *    session that actually owns the usage row (never mix another session's
 *    numbers with this session's model — size is model-specific)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ cwdFilter?: string }} [opts]
 */
export function readStatus(db, { cwdFilter = '' } = {}) {
  const latestParams = cwdFilter ? [cwdFilter] : [];
  const latestSession = db
    .prepare(
      `
      SELECT id, model, title, status, last_activity_at
      FROM sessions
      WHERE deleted_at IS NULL
      ${cwdFilter ? 'AND cwd = ?' : ''}
      ORDER BY last_activity_at DESC
      LIMIT 1
    `
    )
    .get(...latestParams);

  const staleAfterMs = getConfig().quotaStaleMs;

  if (!latestSession) {
    return computeStatus({ source: 'empty', staleAfterMs });
  }

  let usage = db
    .prepare(
      `
      SELECT used, size, updated_at, credit_json
      FROM session_usage
      WHERE session_id = ?
      LIMIT 1
    `
    )
    .get(latestSession.id);

  let source = 'session';
  let owner = latestSession;
  if (!usage) {
    // 回退时必须连 usage 所属会话一起取出来：size 由 model 决定，
    // 拿 A 会话的 model 配 B 会话的 used/size 会得出完全错误的百分比。
    const fb = (scoped) =>
      db
        .prepare(
          `
          SELECT u.used, u.size, u.updated_at, u.credit_json,
                 s.id AS owner_id, s.model AS owner_model, s.title AS owner_title,
                 s.status AS owner_status, s.last_activity_at AS owner_last_activity_at
          FROM session_usage u
          LEFT JOIN sessions s ON s.id = u.session_id
          ${scoped ? 'WHERE s.cwd = ?' : ''}
          ORDER BY u.updated_at DESC
          LIMIT 1
        `
        )
        .get(...(scoped ? [cwdFilter] : []));

    usage = cwdFilter ? fb(true) || fb(false) : fb(false);
    source = 'fallback';
    if (usage && usage.owner_id) {
      owner = {
        id: usage.owner_id,
        model: usage.owner_model,
        title: usage.owner_title,
        status: usage.owner_status,
        last_activity_at: usage.owner_last_activity_at
      };
    }
  }

  return computeStatus({
    model: owner.model,
    title: owner.title,
    status: owner.status,
    used: usage ? usage.used : null,
    size: usage ? usage.size : null,
    credit_json: usage ? usage.credit_json : null,
    lastActivityAt: owner.last_activity_at,
    updatedAt: usage ? usage.updated_at : null,
    staleAfterMs,
    source
  });
}
