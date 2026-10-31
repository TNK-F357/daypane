import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// Load an optional config.json from the project root so users can tune
// behaviour without editing code. Precedence: env var > config.json > default.
// `getConfig()` re-reads config.json on every call → editing config.json and
// refreshing the dashboard takes effect WITHOUT restarting the service.
const HOME = homedir();

const DEFAULT_STOCKS = [
  { sym: 'SPY', name: '标普ETF', mkt: 'US' },
  { sym: 'QQQ', name: '纳指ETF', mkt: 'US' },
  { sym: 'NVDA', name: '英伟达', mkt: 'US' },
  { sym: 'AAPL', name: '苹果', mkt: 'US' },
  { sym: '000001.SS', name: '上证指数', mkt: 'A' },
  { sym: '399001.SZ', name: '深证成指', mkt: 'A' },
  { sym: '600519.SS', name: '贵州茅台', mkt: 'A' },
  { sym: '300750.SZ', name: '宁德时代', mkt: 'A' }
];
const DEFAULT_CLOCKS = [
  { city: '伦敦', tz: 'Europe/London' },
  { city: '洛杉矶', tz: 'America/Los_Angeles' },
  { city: '纽约', tz: 'America/New_York' },
  { city: '德里', tz: 'Asia/Kolkata' }
];

function buildConfig() {
  let fileConfig = {};
  try {
    const p = process.env.SHAWN_CONFIG || join(process.cwd(), 'config.json');
    if (existsSync(p)) fileConfig = JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    /* ignore */
  }

  const cfg = {
    host: fileConfig.host ?? '0.0.0.0',
    port: Number(fileConfig.port ?? 8787),

    dbPath: join(HOME, '.workbuddy', 'workbuddy.db'),
    cwdFilter: '',

    weather: {
      city: '深圳',
      lat: 22.54,
      lon: 114.06,
      ...(fileConfig.weather || {})
    },
    fxBase: fileConfig.fxBase ?? 'USD',
    stocks: fileConfig.stocks ?? DEFAULT_STOCKS,
    clocks: fileConfig.clocks ?? DEFAULT_CLOCKS,

    claudeCap: Number(fileConfig.claudeCap ?? 1000),
    codexCap: Number(fileConfig.codexCap ?? 500),

    staleMs: Number(fileConfig.staleMs ?? 10 * 60 * 1000),
    // 用量数据（session_usage.updated_at）超过这个时长没更新，就标记为陈旧。
    // 默认 6 小时：会话进行中每次请求都会刷新，久于这个时间说明真的停了。
    quotaStaleMs: Number(fileConfig.quotaStaleMs ?? 6 * 60 * 60 * 1000),

    // 运行模式：local = 直接读本机 DB；cloud = 无 DB，用本机上报上来的 data/quotas.json
    mode: fileConfig.mode ?? 'local',
    // 上报额度文件（cloud 模式读取，本机上报器写入）
    quotasFile: join(process.env.SHAWN_DATA_DIR || join(HOME, '.local', 'share', 'shawn-kanban'), 'quotas.json'),
    // 上报数据超过这个时长没更新，就在看板上标成"电脑离线"
    reportStaleMs: Number(fileConfig.reportStaleMs ?? 15 * 60 * 1000)
  };

  // Environment overrides (documented in README).
  const env = process.env;
  if (env.HOST) cfg.host = env.HOST;
  if (env.PORT) cfg.port = Number(env.PORT);
  if (env.WORKBUDDY_DB_PATH) cfg.dbPath = env.WORKBUDDY_DB_PATH;
  if (env.WORKBUDDY_CWD) cfg.cwdFilter = env.WORKBUDDY_CWD;
  if (env.DASH_CITY) cfg.weather.city = env.DASH_CITY;
  if (env.DASH_LAT) cfg.weather.lat = Number(env.DASH_LAT);
  if (env.DASH_LON) cfg.weather.lon = Number(env.DASH_LON);
  if (env.DASH_FX_BASE) cfg.fxBase = env.DASH_FX_BASE;
  if (env.DASH_STOCKS) {
    try { cfg.stocks = JSON.parse(env.DASH_STOCKS); } catch { /* ignore */ }
  }
  if (env.DASH_CLOCKS) {
    try { cfg.clocks = JSON.parse(env.DASH_CLOCKS); } catch { /* ignore */ }
  }
  if (env.DASH_CLAUDE_CAP) cfg.claudeCap = Number(env.DASH_CLAUDE_CAP);
  if (env.DASH_CODEX_CAP) cfg.codexCap = Number(env.DASH_CODEX_CAP);
  if (env.SHAWN_MODE) cfg.mode = env.SHAWN_MODE;
  if (env.SHAWN_QUOTAS_FILE) cfg.quotasFile = env.SHAWN_QUOTAS_FILE;
  if (env.SHAWN_REPORT_STALE_MS) cfg.reportStaleMs = Number(env.SHAWN_REPORT_STALE_MS);
  if (env.SHAWN_QUOTA_STALE_MS) cfg.quotaStaleMs = Number(env.SHAWN_QUOTA_STALE_MS);

  return cfg;
}

// Static snapshot for startup-time concerns (host/port/dbPath). Providers that
// need fresh values (stocks/clocks/weather/fx/caps) must use getConfig().
export const config = buildConfig();
export function getConfig() {
  return buildConfig();
}

// Where the local AI-tool history lives on each OS.
// Note: this machine has no ~/.claude or codex; the real, always-present
// transcript source is WorkBuddy's own project transcripts (jsonl), so we
// point `claude` there to derive a real "weekly activity" metric.
export const paths = {
  claude: join(HOME, '.workbuddy', 'projects'),
  codexCandidates: [
    join(HOME, '.codex'),
    join(HOME, '.config', 'codex'),
    join(HOME, 'AppData', 'Roaming', 'codex'),
    join(HOME, 'AppData', 'Local', 'codex')
  ]
};
