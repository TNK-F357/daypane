import { readStatus } from '../db.js';
import { getConfig } from '../config.js';

// WorkBuddy 用量，读自本机 SQLite（只读）。
//
// 两个不同的量，别再混成一个"额度"：
//   context = 当前会话的上下文水位 / 模型上下文窗口（会在自动压缩时暴跌、换会话时归零）
//   credit  = 该会话每次请求计费的累加（单调不减，才是真正"花掉多少"）
// 字段上同时保留旧的 used/cap/remaining/percent/unit，供老客户端与云端旧
// quotas.json 兼容；新渲染一律读 context / credit。
export function getWorkbuddy(db) {
  if (!db) {
    return {
      ok: false, error: 'db unavailable', model: 'unknown', token: null,
      context: null, credit: { used: null, count: null },
      used: null, cap: null, remaining: null, percent: 0, unit: 'tokens'
    };
  }
  try {
    const s = readStatus(db, { cwdFilter: getConfig().cwdFilter });
    const t = s.context || s.token || {};
    const ctx = {
      used: t.used ?? null,
      size: t.size ?? null,
      remaining: t.remaining ?? null,
      percent: t.percent ?? null
    };
    return {
      ok: true,
      model: s.model,
      title: s.title,
      context: ctx,
      credit: { used: s.creditUsed ?? null, count: s.creditCount ?? null },
      // --- 兼容字段 ---
      token: ctx,
      used: ctx.used,
      cap: ctx.size,
      remaining: ctx.remaining,
      percent: ctx.percent,
      unit: 'tokens',
      stale: !!s.stale,
      lastActivityAt: s.lastActivityAt,
      updatedAt: s.updatedAt,
      source: s.source
    };
  } catch (e) {
    return {
      ok: false, error: e.message, model: 'unknown', token: null,
      context: null, credit: { used: null, count: null },
      used: null, cap: null, remaining: null, percent: 0, unit: 'tokens'
    };
  }
}
