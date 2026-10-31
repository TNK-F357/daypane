#!/usr/bin/env node
// 手动执行一次额度上报（看板服务 :8787 会在每次出图时自动顺带上报，通常不用手动跑）。
//
// 环境变量：
//   GITHUB_TOKEN   要能写仓库（勾 repo 或 contents:write）
//   GITHUB_REPO   owner/repo，例如 shenliucn-prog/daypane
//   GITHUB_BRANCH 默认 runtime-data
//   REPORT_PATH   仓库内路径，默认 quotas.json
//   REPORT_EVERY  最小上报间隔（毫秒），默认 5 分钟
//   REPORT_DRY    设为 1 时只写本地文件，不推远端
//   REPORT_KEEP_TITLE 设为 1 时保留会话标题；默认脱敏（runtime-data 是公开分支）
//
// 用法：
//   node tools/report_quota.js              # 上报一次（有变化才推）
//   node tools/report_quota.js --force      # 强制推一次（含 git 回退通道）
//   node tools/report_quota.js --loop       # 常驻循环（不走 git 通道，避免弹窗）
//   node tools/report_quota.js --dry        # 只写本地，不推远端

import { format } from 'node:util';
import { openDb, closeDb } from '../src/db.js';
import { config } from '../src/config.js';
import { createQuotaReporter } from '../src/reporter.js';

const EVERY = Number(process.env.REPORT_EVERY || 5 * 60 * 1000);

function log(...a) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log('[' + ts + ']', format(...a));
}

let db = null;
try {
  db = openDb(config.dbPath);
} catch (e) {
  console.log('DB unavailable:', e.message);
}

const args = process.argv.slice(2);
const loop = args.includes('--loop');
// 后台常驻进程绝不走 git 通道 —— 凭据失效时会变成每 5 分钟弹一次窗。
const allowGit = !loop && args.includes('--force');

const reporter = createQuotaReporter({ db, cfg: config, allowGit, everyMs: EVERY, log });

try {
  if (!loop) {
    await reporter.once({ force: args.includes('--force') });
  } else {
    log('loop mode, every', Math.round(EVERY / 1000), 's');
    // 常驻模式下没有 once() 那样的一次性入口：直接定时触发节流上报。
    for (;;) {
      reporter.maybeReport();
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
      // maybeReport 内部持有节流与退避状态，这里只负责周期性唤醒。
    }
  }
} finally {
  if (db) closeDb(db);
}
