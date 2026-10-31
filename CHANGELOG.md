# Changelog

## Unreleased

- Close the gaps found by the 2026-10-31 code review:
  - the browser dashboard assigned new data to a `const` binding, so every automatic refresh threw and was swallowed — the page silently stopped updating after the first load;
  - the browser dashboard still showed the retired "quota" semantics (remaining/size plus hand-written Claude Code and Codex caps) while the PNG renderer had already moved to Context / Spent / 7d activity;
  - `Access-Control-Allow-Origin: *` on every JSON response let any page open in the user's browser read `/api/dashboard` (session title included) — removed; the board is same-origin and the Kindle speaks LuaSocket, so nothing needed it;
  - `/api/status` had no `try/catch` and the process had no `uncaughtException` guard, so a WorkBuddy schema change became a crash loop and a black screen;
  - the deployment docs still said to set `cancel-in-progress: false` — precisely the setting that stalled the whole pipeline for five days;
  - the English image leaked Chinese from units hard-coded in format strings ("2 次", "42 条 · 4 会话"); the renderer now records every string it draws and fails the English build if any CJK reaches the canvas;
  - the public `runtime-data` branch carried the Windows machine name and the local Codex path.
- 修复 2026-10-31 代码审查发现的问题：
  - 浏览器看板把新数据赋给了 `const` 绑定，每次自动刷新都抛异常并被吞掉 —— 页面首次加载后就不再更新；
  - 浏览器看板仍显示已废弃的"额度"语义（剩余/总量 + Claude Code/Codex 手写上限），而 PNG 版早已改成 上下文 / 已消耗 / 本周活动；
  - 所有 JSON 响应都带 `Access-Control-Allow-Origin: *`，用户浏览器里打开的任意网页都能读走含会话标题的 `/api/dashboard` —— 已去掉；看板是同源、Kindle 走 LuaSocket，都不需要它；
  - `/api/status` 没有 try/catch，进程也没有 `uncaughtException` 兜底，WorkBuddy 一次表结构变更就会变成崩溃循环 + 黑屏；
  - 部署文档仍写着 `cancel-in-progress: false` —— 正是那个把流水线堵了 5 天的设置；
  - 英文图里混着硬编码在格式串里的中文单位（"2 次"、"42 条 · 4 会话"）；渲染器现在会记录画上去的每一个字符串，英文版一旦有中文上屏就构建失败；
  - 公开的 `runtime-data` 分支里带着 Windows 机器名和本机 Codex 路径。

- The quota reporter is no longer a separate always-on process. It is now a side effect of the dashboard service: every generated screen triggers a throttled upload, so the reporter's lifetime follows the board (and WorkBuddy) instead of boot. The second startup entry (`DayPaneQuotaReporter.vbs`) is gone. Secrets are read straight from `tools/report_secrets.bat` on each attempt — no restart needed after editing it, and no reliance on the guardian script re-reading its own file. Background runs can never touch git credentials (a dead token used to mean a credential prompt every 5 minutes); the git fallback is manual-only, via `report_quota.bat --force`.
- 额度上报器不再是独立的常驻进程，改为看板服务的副产物：每次出图触发一次带节流的上报，生命周期天然跟着看板（也就跟着 WorkBuddy）走，而不是跟着开机走。第二个开机自启项 `DayPaneQuotaReporter.vbs` 已移除。敏感配置改为每次上报时直接读 `tools/report_secrets.bat`，改完不用重启服务，也不依赖守护脚本重载自身。后台运行绝不触碰 git 凭据（此前令牌失效会导致每 5 分钟弹一次窗）；git 回退通道只保留手动 `report_quota.bat --force`。

- Fix the AI usage block's semantics: `session_usage.used/size` is the session's **context watermark** against the model's context window (it collapses on auto-compaction and resets on a new session), not an account balance. The block is now titled "WorkBuddy usage" (all three rows read from WorkBuddy; falls back to the generic "AI usage" title only when Codex is actually installed) and shows Context (used/window), Spent (cumulative `credit_json`, monotonic) and 7d activity; fake "quota" progress bars for Claude Code/Codex (hand-written caps) are gone, and not-installed providers are hidden.
- 修正 AI 用量区块的语义：`session_usage.used/size` 是当前会话上下文水位 / 模型上下文窗口（自动压缩时暴跌、换会话归零），不是账户余额。区块标题改为「WorkBuddy 用量」（三行都读自 WorkBuddy；仅当确实装了 Codex 才退回泛指的「AI 用量」），内容为 上下文（已用/窗口）、已消耗（`credit_json` 累计，单调不减）与 本周活动；Claude Code/Codex 手写上限的假"额度"进度条移除，未安装的行不再显示。
- `readStatus` fallback no longer mixes another session's usage with the newest session's model (size is model-specific); the fallback prefers the same cwd and carries the owning session's model/title. Stale usage (default `quotaStaleMs` = 6h) is now flagged.
- `readStatus` 回退不再把别的会话的用量配到最新会话的 model 上（size 由 model 决定）；回退优先同 cwd，并携带 usage 所属会话的 model/title。用量超过 `quotaStaleMs`（默认 6 小时）未更新时标记 stale。
- Quota reporter now falls back to a plain `git push` (Windows Credential Manager) when the API token is missing or rejected, so cloud data keeps flowing without a PAT.
- 上报器在 API 令牌缺失/失效时自动回退为普通 `git push`（走 Windows 凭据管理器），云端数据不再依赖 PAT 存活。

- Make the render workflow self-healing: with `cancel-in-progress: true`, a run stuck in the Pages deploy queue is cancelled by the next run instead of blocking every later render.
- 渲染工作流改为可自愈：`cancel-in-progress: true` 后，卡在 Pages 部署队列里的运行会被下一次运行取消，不再阻塞后续所有渲染。

- Redact the local session title before uploading quotas to the public `runtime-data` branch; the local `quotas.json` keeps the full value. Set `REPORT_KEEP_TITLE=1` to opt out.
- 上报额度到公开分支 `runtime-data` 前脱敏本机会话标题，本机 `quotas.json` 仍保留完整内容；`REPORT_KEEP_TITLE=1` 可关闭脱敏。

- Move repository and Pages URLs to `daypane`; migrate the two saved built-in cloud image URLs on plugin upgrade, preserving custom URLs and language.
- 仓库及 Pages 地址迁移至 `daypane`；升级插件时自动迁移两个内置旧图源，保留自定义地址和语言。

- Rename the project, dashboard and plugin menu to DayPane; improve English and Chinese Kindle repurposing documentation.
- Keep the KindleDash plugin identity, saved settings, environment variables and local data paths compatible.
- 项目、看板和插件菜单更名为 DayPane（日窗），补充中英文 Kindle 改造介绍；保留插件标识、已有配置、环境变量和本地数据路径。

## 0.3.3

- Use a single refresh timer; completion alone schedules the next attempt and preserves retry backoff.
- Preserve the last good image on every rename failure.
- Make Wi-Fi management opt-in; release only a radio started by the dashboard on success, timeout, cancellation or suspend. Ignore late callbacks after cancellation.
- Update English and Chinese installation and operating-mode guidance.

## 0.3.2

- Field test verdict on the Paperwhite 3: the RTC alarm does fire (crash.log shows the scheduled
  wake and a hardware resume), but the device wakes ~90–100 s after the programmed epoch, which
  exceeds `WakeupMgr:wakeupAction(90)`'s proximity window. The queued task is therefore rejected
  ("Kindle unscheduled wakeup") and never runs. Recurring RTC wake cannot deliver auto-refresh on
  this device and is now opt-in (`rtc_wake` setting, default off).
- Hold-awake mode replaces it (on by default): while the dashboard is shown, the plugin pauses
  KOReader's AutoSuspend (`PluginShare.pause_auto_suspend`) and blocks the firmware
  screensaver/suspend (`lipc-set-prop com.lab126.powerd preventScreenSaver 1`) — the same
  dual-channel approach the device's keepalive plugin uses. The UI timer then refreshes on
  schedule; a menu toggle turns the mode off.
- Manual power-key suspend still works: suspending releases the hold, and resuming re-engages it
  when the dashboard is still on screen. Closing the dashboard releases the hold so the device
  sleeps normally again.
- Suspend health records now say `hold-screen mode` / `rtc armed` / `rtc NOT armed`, and hold
  engagement is recorded (`hold_screen_on`/`hold_screen_off`), so the refresh mode is always
  visible in the log. Device status shows the hold state.

## 0.3.0

- Merged the `runtime.lua` overlay into `main.lua`. The old dual-layer plugin was loaded as
  `main.lua` + `dofile('runtime.lua')`, so `runtime.lua` silently redefined `fetchScreen`,
  `armAutoRefresh`, `onResume`, `holdAwake` and `init`; roughly half of `main.lua` was dead code
  and edits there had no effect. The plugin is now a single implementation.
- Fixed: waking the device with the power key could leave the dashboard unclosable until reboot.
  `onResume` used to call `power.resetT1Timeout()` (Kindle `powerd` native) synchronously at the
  suspend/resume boundary, which deadlocked the UI event loop.
- Fixed: the dashboard never auto-refreshed while idle. `holdAwake` relied on
  `PluginShare.pause_auto_suspend` + `resetT1Timeout`, which do not stop firmware screen savers on
  Kindle; the device suspended anyway and `UIManager:scheduleIn` timers stop while suspended.
  Those hacks are gone.
- Auto-refresh now uses RTC wake: the device sleeps normally and `Device.wakeup_mgr:addTask()`
  wakes it once per interval to refresh and re-arm the next wake. No always-on, no screen saver fight.
- HTTPS CA bundle is now resolved at `<datadir>/data/ca-bundle.crt` with a fallback, instead of the
  wrong `<datadir>/ca-bundle.crt`. The previous path made every cloud fetch fail with
  "CA bundle missing".
- `requestRefresh` always releases its re-entrancy lock, so a skipped background refresh can no
  longer stop auto-refresh permanently.
- Restored managed Wi-Fi (`managed_wifi` / `wifi_off`) before each fetch with a 60-second deadline,
  since a Kindle that wakes from RTC wake usually has Wi-Fi off.

## 0.3.1

- Cache writes use a unique temporary file. Two concurrent refreshes (UI timer, RTC wake, resume) used to share one `.pending` file, so the slower one kept appending into the file the faster one had already renamed — a corrupt image that then persisted on screen.
- Suspending during a refresh no longer wedges the re-entrancy lock. `_busy` stayed `true` and every later refresh returned immediately, so auto-refresh died until a restart.
- A manual refresh can now preempt an in-flight background refresh instead of being dropped with no feedback.
- Resume refresh goes through the shared refresh entry point, so it also gets managed Wi-Fi and the backoff retry instead of a second, competing retry loop.
- Suspend records whether the RTC alarm is actually armed (`rtc armed` / `rtc NOT armed` in the health log), so a broken wake chain is visible instead of silent.
- `Device.wakeup_mgr` missing is logged and recorded instead of silently downgrading to "only refreshes while awake".
- Closing the plugin no longer clears the auto-refresh preference.
- Saving a LAN address without a port keeps the configured port instead of silently using port 80.
- Refresh interval is clamped in one place; the UI timer and the RTC wake no longer disagree.

## 0.2.0

- Versioned display manifests and SHA-256 verification, bounded downloads and decode-before-replace caches.
- Local device diagnostics, battery event history and bounded retry backoff.
- Opt-in Wi-Fi management, adjustable refresh intervals and night schedule.
- Supervised, single RTC wake experiment (not recurring and not hardware-validated).
- English/Chinese setup guidance, versioned plugin packages and rollback instructions.
- Browser-only renderer configuration, daily/work/minimal profiles, module ordering, screen dimensions, font scale, timezone and temperature units.
- Existing Chinese settings and image URLs preserved; new installs have no personal LAN default.

Physical Kindle validation and 48-hour battery measurements remain pending.
