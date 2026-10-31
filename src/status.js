// Pure, framework-free status computation.
// This module has no I/O and is fully unit-testable without a database.

/**
 * Normalize a raw reading into the status object served to the Kindle.
 * @param {object} raw
 * @param {string} [raw.model]
 * @param {string} [raw.title]
 * @param {string} [raw.status]
 * @param {number} [raw.used]
 * @param {number} [raw.size]
 * @param {string} [raw.credit_json]
 * @param {number} [raw.lastActivityAt]
 * @param {number} [raw.updatedAt]
 * @param {string} [raw.source]
 * @param {number} [raw.staleAfterMs] 用量数据超过这个时长没更新就标 stale
 * @param {number} [raw.now] 注入当前时间（测试用）
 *
 * 语义警告：`used / size` 来自 WorkBuddy 的 session_usage，它统计的是
 * **当前会话的上下文水位 / 该模型的上下文窗口**，会在自动压缩（compact）时
 * 暴跌，也会在新开会话时归零 —— 它不是账户剩余额度，不能当"余额"展示。
 * 真正单调不减、反映"花掉多少"的是 credit_json 的求和。
 */
export function computeStatus(raw = {}) {
  const model = raw.model || 'unknown';
  const title = raw.title || null;
  const status = raw.status || null;

  const used = Number.isFinite(raw.used) ? raw.used : null;
  const size = Number.isFinite(raw.size) ? raw.size : null;

  let remaining = null;
  let percent = null;
  if (used != null && size != null && size > 0) {
    remaining = Math.max(0, size - used);
    percent = Math.min(100, Math.max(0, Math.round((used / size) * 1000) / 10));
  }

  // credit_json 形如 { requestId: credit } —— 每次请求的计费累加，
  // 不受上下文压缩影响，是唯一单调的"已消耗"指标。
  let credit = null;
  let creditUsed = null;
  let creditCount = null;
  if (raw.credit_json) {
    try {
      const parsed = JSON.parse(raw.credit_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        credit = parsed;
        const vals = Object.values(parsed).filter((v) => Number.isFinite(v));
        creditCount = vals.length;
        creditUsed = Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
      }
    } catch {
      credit = null;
    }
  }

  const staleAfterMs = Number.isFinite(raw.staleAfterMs) ? raw.staleAfterMs : 0;
  const now = Number.isFinite(raw.now) ? raw.now : Date.now();
  const stale = Number.isFinite(raw.updatedAt) && staleAfterMs > 0
    ? now - raw.updatedAt > staleAfterMs
    : false;

  // context 与 token 指向同一份数字：context 是语义正确的名字（上下文水位），
  // token 保留给老客户端/老 quotas.json 兼容，别再新增依赖 token 的代码。
  const context = { used, size, remaining, percent };

  return {
    model,
    title,
    status,
    context,
    token: context,
    credit,
    creditUsed,
    creditCount,
    stale,
    lastActivityAt: raw.lastActivityAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    source: raw.source || 'unknown'
  };
}

/**
 * Render a compact, human-readable one-liner (used by logs / e-ink fallback).
 */
export function formatStatus(s) {
  const t = s.context || s.token || {};
  const pct = t.percent == null ? 'n/a' : `${t.percent}%`;
  const rem = t.remaining == null ? 'n/a' : `${t.used} / ${t.size}`;
  const titlePart = s.title ? ` title=${s.title}` : '';
  const creditPart = s.creditUsed == null ? '' : ` credit=${s.creditUsed}(${s.creditCount} req)`;
  return `model=${s.model} ctx=${rem} (${pct})${creditPart}${titlePart}`;
}
