// 本机 WorkBuddy 用量上报。
//
// 云端（GitHub Actions）拿不到本机的 workbuddy.db，只能靠本机把一份快照推到
// runtime-data 分支，云上再拿它渲染兜底图。所以这个模块存在的唯一理由是：
// **Kindle 连得上公网、但连不上家里这台 PC 时**（带出门、连了热点、PC 的 IP 变了）。
//
// PC 关机时用不上它 —— 那种情况下 Kindle 显示的是插件自己的本地持久缓存，
// 那份缓存来自局域网直连，比任何上报都要新。
//
// ⚠️ 硬原则：后台常驻进程**绝不允许**触发 git 凭据交互。令牌失效时那会变成
// 每 5 分钟弹一次窗。git 回退通道只在手动执行 CLI 时开启（allowGit）。

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { format } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';
import { shouldUpload } from './report-policy.js';
import { getWorkbuddy } from './providers/workbuddy.js';
import { getClaudeCodeUsage } from './providers/claudecode.js';
import { getCodexUsage } from './providers/codex.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function defaultLog(...a) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  // console.log 只对第一个参数做 %s 替换，所以这里先 format 再拼时间戳
  console.log('[' + ts + '] [quota]', format(...a));
}

// runtime-data 是公开分支：默认抹掉本机会话标题，只留数字。
// 本机 quotas.json 仍保留完整内容，脱敏只作用于推送出去的那份。
export function redact(data, { keepTitle } = {}) {
  const out = JSON.parse(JSON.stringify(data));
  // 机器名永远不带出去（REPORT_KEEP_TITLE 也管不到它）：runtime-data 是公开的，
  // 而 Windows 的 COMPUTERNAME 默认就是用户名派生值，等于公开本机身份标识。
  // 云端渲染也用不到这个字段。
  if (out.host) out.host = '';
  if (!keepTitle) {
    const wb = out.quotas && out.quotas.workbuddy;
    if (wb && Object.prototype.hasOwnProperty.call(wb, 'title')) wb.title = '';
  }
  return out;
}

// 令牌等敏感配置放在被 gitignore 的 tools/report_secrets.bat 里（格式：`set "KEY=value"`）。
// 这里自己读它，而不是依赖启动脚本 `call` 注入环境变量 —— 看板服务是由守护脚本拉起的
// 常驻进程，改了 bat 它不一定会重载。每次上报前重新解析，改了配置不用重启服务。
// 环境变量优先级更高，方便临时覆盖。
const SECRET_KEYS = ['GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH', 'REPORT_PATH', 'REPORT_EVERY', 'REPORT_DRY', 'REPORT_KEEP_TITLE'];

function loadSecrets() {
  const p = join(REPO_ROOT, 'tools', 'report_secrets.bat');
  const out = {};
  let text;
  try {
    text = readFileSync(p, 'utf-8');
  } catch {
    return out;
  }
  const re = /^\s*set\s+"?([A-Z_]+)"?\s*=\s*"?([^"]*)"?\s*$/i;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    if (SECRET_KEYS.includes(key) && value) out[key] = value;
  }
  return out;
}

function resolveSecrets() {
  const file = loadSecrets();
  return {
    token: process.env.GITHUB_TOKEN || file.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || file.GITHUB_REPO || '',
    branch: process.env.GITHUB_BRANCH || file.GITHUB_BRANCH || 'runtime-data',
    path: process.env.REPORT_PATH || file.REPORT_PATH || 'quotas.json',
    dry: process.env.REPORT_DRY === '1' || file.REPORT_DRY === '1',
    keepTitle: process.env.REPORT_KEEP_TITLE === '1' || file.REPORT_KEEP_TITLE === '1'
  };
}

function collect(db) {
  return {
    ts: Date.now(),
    host: process.env.COMPUTERNAME || '',
    quotas: {
      workbuddy: getWorkbuddy(db),
      claudecode: getClaudeCodeUsage(),
      codex: getCodexUsage()
    }
  };
}

async function pushToGithub(content, { log }) {
  const { token, repo, branch, path: remotePath } = resolveSecrets();
  if (branch === 'main' || branch === 'master') {
    log('skip push: uploads to source branches are disabled');
    return false;
  }
  if (!token || !repo) {
    log('skip push: need GITHUB_TOKEN and GITHUB_REPO');
    return false;
  }
  const api = 'https://api.github.com/repos/' + repo + '/contents/' + remotePath;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'shawn-kanban-reporter',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  let sha = null;
  const getRes = await fetch(api + '?ref=' + branch, { headers, signal: AbortSignal.timeout(15000) });
  if (getRes.ok) {
    const j = await getRes.json();
    sha = j.sha;
  } else if (getRes.status !== 404) {
    log('gh get failed', getRes.status, (await getRes.text()).slice(0, 120));
    return false;
  }

  const body = {
    message: 'chore(quotas): update ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch
  };
  if (sha) body.sha = sha;

  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    log('gh put failed', res.status, (await res.text()).slice(0, 200));
    return false;
  }
  log('pushed to github', repo, remotePath);
  return true;
}

// 回退通道：GITHUB_TOKEN 缺失/失效时，改走本机 git（Windows 凭据管理器里的有效凭据）。
// 流程与 GitHub Contents API 等价：在 runtime-data 之上构造一个只改 quotas.json 的提交。
//
// ⚠️ 只允许**手动执行**时调用。看板服务是开机后台常驻进程，在这里弹凭据窗口 =
// 用户的电脑每 5 分钟被顶一次 —— 这个坑踩过。
function pushViaGit(content, { log }) {
  const { branch, path: remotePath } = resolveSecrets();
  const tmp = join(tmpdir(), 'quotas-remote-' + Date.now() + '.json');
  const idx = join(REPO_ROOT, '.git', 'tmp-report-index');
  // 公开仓库匿名 fetch 不需要凭据：指到空配置上，绕开系统里那几个 credential helper。
  const anonCfg = join(tmpdir(), 'quotas-empty-gitconfig-' + Date.now());
  try {
    writeFileSync(tmp, content);
    writeFileSync(anonCfg, '');
    const g = (args, extra = {}) =>
      execFileSync('git', ['-C', REPO_ROOT, ...args], {
        encoding: 'utf-8', maxBuffer: 1 << 24, timeout: 120000, ...extra,
      }).trim();
    const anon = {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: anonCfg,
        GIT_CONFIG_SYSTEM: anonCfg,
        GIT_TERMINAL_PROMPT: '0'
      }
    };
    g(['fetch', '--no-tags', 'origin', branch], anon);
    const base = g(['rev-parse', 'FETCH_HEAD']);
    const ie = { env: { ...process.env, GIT_INDEX_FILE: idx } };
    g(['read-tree', base], ie);
    const blob = g(['hash-object', '-w', tmp], ie);
    g(['update-index', '--add', '--cacheinfo', `100644,${blob},${remotePath}`], ie);
    const tree = g(['write-tree'], ie);
    const msg = 'chore(quotas): update ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    const commit = g(['commit-tree', tree, '-p', base, '-m', msg], ie);
    g(['push', 'origin', `${commit}:refs/heads/${branch}`]);
    log('pushed via git', commit.slice(0, 8));
    return true;
  } catch (e) {
    log('git push failed:', String(e.stderr || e.message || e).split('\n').filter(l => /fatal|error/i.test(l))[0]?.slice(0, 180) || String(e).slice(0, 180));
    return false;
  } finally {
    try { unlinkSync(idx); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    try { unlinkSync(anonCfg); } catch { /* ignore */ }
  }
}

export function createQuotaReporter({
  db = null,
  cfg = config,
  log = defaultLog,
  allowGit = false,
  everyMs = Number(process.env.REPORT_EVERY || 5 * 60 * 1000)
} = {}) {
  const ackOut = join(dirname(cfg.quotasFile), 'last-upload.json');
  const maxBackoff = Math.max(everyMs, 30 * 60 * 1000);

  let lastAttempt = 0;
  let streak = 0;
  let running = false;

  // 返回 true = 这一轮没问题（无变化 或 推送成功），false = 推送失败需要退避。
  async function once({ force = false } = {}) {
    const data = collect(db);
    const text = JSON.stringify(data, null, 2);

    let prev = null;
    try {
      if (existsSync(ackOut)) prev = JSON.parse(readFileSync(ackOut, 'utf-8'));
    } catch {
      /* ignore */
    }

    const secrets = resolveSecrets();
    const changed = shouldUpload(prev, data, Date.now(), force);
    const pushText = JSON.stringify(redact(data, secrets), null, 2);
    try {
      mkdirSync(dirname(cfg.quotasFile), { recursive: true });
      writeFileSync(cfg.quotasFile, text);
    } catch (e) {
      log('write local failed:', e.message);
    }

    if (!changed) {
      log('no significant change');
      return true;
    }
    if (secrets.dry) return true;

    const ok = (await pushToGithub(pushText, { log })) || (allowGit && pushViaGit(pushText, { log }));
    if (ok) writeFileSync(ackOut, pushText);
    return ok;
  }

  function nextDelay() {
    if (!streak) return everyMs;
    // 推送失败大多是令牌失效，几分钟内重试没意义：指数退避到最多 30 分钟。
    return Math.min(everyMs * Math.pow(2, streak), maxBackoff);
  }

  // fire-and-forget：绝不阻塞请求，也绝不抛给调用方。
  function maybeReport(force = false) {
    if (running) return false;
    const now = Date.now();
    if (!force && now - lastAttempt < nextDelay()) return false;
    lastAttempt = now;
    running = true;
    void once({ force })
      .then(ok => {
        streak = ok ? 0 : streak + 1;
        if (!ok) log('push failed, retry in', Math.round(nextDelay() / 60000), 'min (streak ' + streak + ')');
      })
      .catch(e => {
        streak += 1;
        log('upload failed:', e.message);
      })
      .finally(() => {
        running = false;
      });
    return true;
  }

  return { once, maybeReport };
}
