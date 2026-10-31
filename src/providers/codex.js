import { join } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { paths, getConfig } from '../config.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;

// Approximate Codex usage by counting history/session files touched in the
// last 7 days under the Codex data directory. Structure varies by version,
// so this is best-effort and clearly labelled as an approximation.
export function getCodexUsage() {
  const cap = getConfig().codexCap;
  const dir = paths.codexCandidates.find((p) => existsSync(p));
  if (!dir) {
    // 本机未安装 Codex：保持与 claudecode 相同的字段结构，UI 预留位置显示"未安装"
    return {
      ok: false,
      error: 'not-installed',
      cap,
      used7d: null,
      remaining: null,
      percent: 0,
      unit: 'messages'
    };
  }
  const cutoff = Date.now() - WEEK;
  let used = 0;
  try {
    const scan = (d, depth) => {
      if (depth > 4) return;
      let entries;
      try {
        entries = readdirSync(d);
      } catch {
        return;
      }
      for (const name of entries) {
        const p = join(d, name);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          // session/conversation folders count as 1 unit if recently modified
          if (st.mtimeMs >= cutoff) used++;
          scan(p, depth + 1);
        } else if (/\.(jsonl|json|log)$/i.test(name) && st.mtimeMs >= cutoff) {
          used++;
        }
      }
    };
    scan(dir, 0);
  } catch (e) {
    return {
      ok: false, error: e.message, cap,
      used7d: null, remaining: null, percent: 0, unit: 'files'
    };
  }
  return {
    ok: true,
    metric: 'activity',
    used7d: used,
    cap,
    remaining: Math.max(0, cap - used),
    percent: cap ? Math.min(100, Math.round((used / cap) * 100)) : 0,
    unit: 'files',
    // 不带绝对路径：这个字段会进公开的 runtime-data/quotas.json，
    // 而路径里含本机用户名。
    source: 'local codex dir (approx)'
  };
}
