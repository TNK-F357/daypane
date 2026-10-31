import { createServer } from './server.js';
import { openDb, closeDb } from './db.js';
import { config } from './config.js';
import { createQuotaReporter } from './reporter.js';

let db = null;
try {
  db = openDb(config.dbPath);
  console.log('[shawn-kanban] opened DB:', config.dbPath);
} catch (e) {
  console.warn('[shawn-kanban] WARN: could not open DB at', config.dbPath, '-', e.message);
  console.warn('[shawn-kanban] service still runs; WorkBuddy quota will show unavailable.');
}

// 上报跟着看板走：只有 DB 可用（= 本机 WorkBuddy 数据在手）时才推云端快照。
// allowGit 默认 false —— 后台常驻进程一旦弹凭据窗口就是每 5 分钟一次。
const reporter = db ? createQuotaReporter({ db, cfg: config }) : null;

const server = createServer({ db, cfg: config, reporter });

server.listen(config.port, config.host, () => {
  console.log(`[shawn-kanban] listening on http://${config.host}:${config.port}`);
  console.log(`[shawn-kanban] Kindle/MacBook open http://<this-machine-ip>:${config.port}/api/dashboard`);
});

function shutdown() {
  console.log('[shawn-kanban] shutting down...');
  try {
    server.close();
  } catch {
    /* ignore */
  }
  if (db) closeDb(db);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 进程级兜底：这个服务常驻，Kindle 每 30 分钟轮询一次 —— 它一挂就是黑屏，
// 而且守护脚本会把它拉起来再崩，形成崩溃循环。
// 只读服务没有"半写"状态，所以这里选择记日志后继续跑，而不是让进程退出。
process.on('uncaughtException', (err) => {
  console.error('[shawn-kanban] uncaught exception (service keeps running):', (err && err.stack) || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[shawn-kanban] unhandled rejection (service keeps running):', (reason && reason.stack) || reason);
});
