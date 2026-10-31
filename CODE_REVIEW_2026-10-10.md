# DayPane 代码审查报告

日期：2026-10-10 · 范围：全仓库（src / tools / plugin / workflows / scripts / docs）
方法：4 个只读 agent 并行审查 + 逐条代码与运行数据核验。**本报告只做诊断，未修改任何代码。**

---

## 一、结论

代码整体是健康的：权限最小化、错误处理有意识、测试 26 个 Node + 11 个 Python 单测齐全。
但有 **3 个会导致用户可见错误或线上事故**的问题、**4 个真缺陷**、若干文档漂移。

最值得注意的是：**HTML 版看板（`/`）还停留在旧的"假额度"语义**，而 PNG 版已经改完——
也就是说我们前两轮修的语义问题，只修了 Kindle 上那半边。

---

## 二、P0 — 会造成用户可见错误或事故

### 1. HTML 看板仍是旧的假额度语义（4 个 agent 都没抓到，我核对 server.js 时发现）

`src/server.js:184-227` 的浏览器看板仍然渲染：

- `WorkBuddy 限额`：`remaining / size` + "已用 X%" 进度条 —— 正是已废弃的语义，
  会在上下文压缩时显示"剩余额度暴涨"；
- `Claude Code 本周 92 / 1000`、`Codex 本周` —— cap 是 `config.json` 里手写的参考值，
  不是额度，且 `claudecode.js:73` 注释已声明"cap 没有真实上限语义"。

而 API 返回结构已改为 `context / credit / activity`（`src/providers/workbuddy.js:22-27`）。
**PNG 走 `render_screen.py` 已改对，HTML 走内联 JS 没改。** 用户在浏览器打开
`http://<PC-IP>:8787/` 看到的是被我们判定为错误的那套东西。

> 建议：`renderHtml` 的内联 JS 同步改成三行 WorkBuddy 用量，与 `draw_ai` 保持同构。

### 2. 部署文档教人把 `cancel-in-progress` 改回 false

- 代码 `render.yml:33` = `true`，且带注释写明"**必须为 true**"（Pages deploy 曾卡在 queued
  永不启动，10-05 卡死 5 天）。
- 文档 `docs/CLOUD_DEPLOY.md:29` 与 `CLOUD_DEPLOY.zh-CN.md:31` 却写：
  "`cancel-in-progress: false` 避免新触发中断正在生成的任务"。

任何人照文档排查流水线并改回 false，就会**精确复现那场 5 天全站停更的事故**。
文档描述与代码/注释完全相反，是本报告里最危险的一条。

### 3. `/api/status` 无 try/catch，且没有进程级兜底 → 可触发崩溃循环

`src/server.js:283`：

```js
const status = db ? readStatus(db, { cwdFilter: cfg.cwdFilter }) : null;
```

这是整个 handler 里**唯一没有 try/catch 的数据源**（`/api/dashboard`、`/`、`/api/screen`、
`/api/display` 全都包了）。handler 是 `async`，抛出的异常变成 `unhandledRejection`，
而 `src/index.js:32-33` 只注册了 SIGINT/SIGTERM，**没有 `uncaughtException` /
`unhandledRejection` 兜底** → Node 默认策略是终止进程。

触发条件很现实：WorkBuddy 升级改了 `session_usage` 表结构（`db.js:65` 查的 `credit_json`
被改名）→ `SqliteError: no such column` → 进程退出 → `run_dash_server.bat` 3 秒后重启 →
Kindle 或浏览器再打一次 `/api/status` 又崩 → **崩溃循环，Kindle 黑屏**。

> 建议：该分支加 try/catch；`index.js` 加两个进程级兜底并记日志（服务不该因一次请求失败而退出）。

---

## 三、P1 — 真缺陷

### 4. 英文版两处漏中文，且 stale 标记是常态

`tools/render_screen.py` 的 `LABELS`（:23-34）：

| 问题 | 证据 |
|---|---|
| `tr(' ·旧')` 传的是**带前导空格**的键，字典里是 `'·旧'`（:27，无空格） | `tr()` 用 `.get(text, text)` 兜底 → 英文版原样输出 ` ·旧` |
| `tr('Codex 文件')`（:374）字典里**没有这个键** | 英文版混入中文 |

`stale` 在云端是常态（PC 关机即超过 `reportStaleMs` 15 分钟），所以**英文云端图基本必然出现中文**。

> 建议：`:364` 改为 `tr('·旧')`；`LABELS` 补 `'Codex 文件': 'Codex files'`。
> 更根本的办法是加一个测试：遍历源码所有 `tr('字面量')`，断言英文下返回值与原串不同。

### 5. 降级数据被当"新鲜数据"缓存，故障被固化

`src/cache.js:46`：

```js
store.set(key, { value: stale, expires: at + ttlMs, fetchedAt: prev.at });
```

stale-while-error 的兜底数据用了**完整 `ttlMs`**。MLB 的 ttl 是 30 分钟
（`mlb.js:121`）→ 一次超时之后，接下来 30 分钟内所有请求直接命中这份 `stale:true` 的旧数据，
producer 再也不会被调用。而 MLB 是唯一需要感知"比赛开始了"的板块（`mlb.js:109`
把 `next.time` 从 `'03:00'` 改成 `'进行中'`），用户最长要等半小时才看得到。

> 建议：降级路径用 `Math.min(ttlMs, 60_000)`，让 stale 只用于短暂抖动。

### 6. `lastOk` 无过期时间 → 交易所后缀回退会被永久锁死

`src/cache.js:5,37`：`lastOk` 只写不删，进程存活期间永不过期。
`src/providers/stocks.js:98-109` 的美股回退按 `.OQ → .N → .AM` 依次尝试，
但判断条件是 `if (spark)`（对象 truthy）。一旦某个后缀**曾经成功过一次**，
之后它失败时 `cache.js:43-47` 会返回 stale 降级对象 → 仍是 truthy → 直接 `return`，
**后续后缀永远不会被尝试**，且 `stale` 标记不透出到渲染层。

> 影响：只在"错误后缀曾返回过有效数据"时触发，属苛刻条件，故列 P1 而非 P0。

### 7. 上报器把 Windows 计算机名推到公开分支

`src/reporter.js:84`：`host: process.env.COMPUTERNAME`，
而 `redact()`（:35-41）只清了 `quotas.workbuddy.title`。

`runtime-data` 分支是公开的（`docs/CLOUD_DEPLOY.md` 自己写明"和本仓库一样公开"），
所以这台机器的名字被公开发布。云端渲染根本不需要 `host` 字段。

> 建议：`redact()` 里一并清掉 `host`。

---

## 四、P2 — 健壮性 / 运维

### 8. Python 解释器探测在请求路径上同步阻塞事件循环

`src/server.js:44-53`：`hasPillow()` 用 `execFileSync(bin, ['-c','import PIL'], {timeout:20000})`
逐个探测候选（`.venv` → WorkBuddy venv → versions/* → python3）。
这些探测发生在**首次渲染时**，也就是 `/api/display` handler 内部。
Node 单线程被同步调用占住时**整个 server 不接受任何连接**——包括渲染进程自己稍后要请求的
`/api/dashboard`（`server.js:58` 的 `--url`）。而插件超时是 8 秒（`main.lua`）。

> 建议：探测挪到启动时异步做，完成前 `/api/display` 返回 503 "renderer warming up"。

### 9. 一个拼错的时区会让整个看板失效

`src/config.js:30-35` 解析 `config.json` 时**只有 try/catch 包 JSON.parse，没有任何字段校验**，
而文件头注释明确鼓励"改 config.json 不用重启即时生效"。

`src/providers/clocks.js:23-27` 直接 `.map()` 调 `timeIn(c.tz)`，无 try/catch；
非法时区会让 `Intl.DateTimeFormat` 抛 `RangeError`。而 `aggregator.js:70` 的
`clocks: getClocks()` 在 **`Promise.all` 之外**（:45）→ 整个 `buildDashboard` reject →
`server.js:277` 返回 `{ok:false}` → 天气、股票、新闻、MLB **全部消失**，
只因为一个时钟的 tz 写错（`America/LosAngeles` 少个下划线这种）。

> 建议：`clocks.js` 单项降级为 `{city, time:'--:--', error}`；`config.js` 校验数组与 tz 合法性。

### 10. 守护脚本空转 3705 次，日志无轮转

实测 `tools/dash_server.log`：**26085 行 / 1.68 MB**，`server exited` 记录 14645 次，
其中 **`code 9009`（node 找不到）3705 次**，集中在 2026-08-28 23:59 → 08-29 03:20，
即 node 路径失效期间每 3 秒重试一次、连续空转 3.5 小时。

`tools/run_dash_server.bat` 没有 `if not exist "%NODE%"` 前置检查，也没有日志轮转。

> 建议：启动前检查 node 存在；连续失败 N 次即停止；日志按大小轮转。

### 11. bat 里的 UTF-8 中文在 GBK 控制台乱码

`tools/*.bat` 全部无 `chcp`，文件是 UTF-8 无 BOM。日志里已经是乱码：
`[2026/10/10 ���� 23:40:28.04] server exited`。`report_quota.bat:15,18` 的
`echo [warn] ...` 是用户可见输出，同样受影响。

### 12. 无用量数据时 API 答 `ok:true` 且"不陈旧"

`src/status.js:60-62`：`updatedAt` 为 null 时 `Number.isFinite(null)` 为 false → `stale=false`；
`src/providers/workbuddy.js:29` 只要读成功就 `ok:true`。于是一个**从未有过用量记录**的库
对外呈现为"数据正常、新鲜"，只是数值全是 `n/a`。下游 `report-policy.js:7` 的
`!!a.ok !== !!b.ok` 也永远看不到状态翻转。

> 建议：`used == null && size == null` 时返回 `ok:false, error:'no usage data'`。

---

## 五、文档漂移（低）

| 位置 | 问题 |
|---|---|
| `.gitignore:34` | `data/quotas.json` 是死规则——真实路径是 `~/.local/share/shawn-kanban/quotas.json`（仓库外，本来就安全） |
| `README.zh-CN.md:64` | 股票列表 4 只 vs `config.json` 8 只 vs `config.js` `DEFAULT_STOCKS` 第三套（NVDA vs MU） |
| `README.zh-CN.md:12` | 仍写"限额"，英文版已改为 "activity estimates" |
| `src/reporter.js:47,69-79` | `REPORT_EVERY` 在 `report_secrets.bat` 里能解析出来，但 `resolveSecrets()` 的返回对象**没有这个字段**，被丢弃 → 实际不生效（我们上一轮"改配置不用重启"的设计对它不成立） |
| `docs/CLOUD_DEPLOY.md:55` | 退避封顶是 `max(everyMs, 30min)`，若用户把 `REPORT_EVERY` 设成 60 分钟，退避等于没退避 |

---

## 六、经核验**不成立**的怀疑（避免误导修复）

| 提出者 | claim | 核验结论 |
|---|---|---|
| agent 4 | `bat` 里 `%errorlevel%` 恒为 0 | **误报**。`%NODE% ...` 与 `echo` 是两行，非括号块内 cmd 逐行执行，展开时机正确 |
| agent 4 | `.gitignore` 未保护真正的敏感文件 | **夸大**。`~/.local/share/shawn-kanban/quotas.json` 在仓库外，git 根本看不到 |
| agent 1 | `getStocks` 缓存 key 是 `'stocks:all'` | 行号/常量名不准（实际是 `'stocks'`），但"key 不含股票列表"这一结论仍成立 |
| agent 3 | 自动刷新链会永久死亡 | **触发条件不成立**。`tick` 确实不自重排（`main.lua:420-426`），`requestRefresh:847` 撞 busy 直接 return 也不 arm；但正常并发下总有另一条 `settle`/`fail_network` 路径接续重排。属**防御性缺口 + 注释与实现不符**（:840 声称"无论哪条分支都会释放"），不是必现 bug |
| agent 3 | `onCloseWidget` 不触发导致常亮不释放 | **未核实**。需要实机验证才能定性，建议列入下次 Kindle 实机验证清单 |

---

## 七、建议修复顺序

1. **#2 文档**（改 2 行，消除复现 5 天停更事故的隐患）
2. **#1 HTML 看板语义**（用户一打开浏览器就能看到错的东西）
3. **#4 英文漏译**（2 处，各改 1 个字符 + 补 1 行字典 + 1 个防复发测试）
4. **#3 `/api/status` 崩溃循环**（加 try/catch + 进程级兜底）
5. **#7 计算机名外泄**（1 行）
6. #5 #6 #9 #12 缓存与降级语义
7. #8 #10 #11 运维健壮性

---

## 八、第二份外部审查报告的逐条核实（2026-10-31）

收到一份外部审查报告，逐条对照代码复核。结论：**有价值，但有一条建议会打断主链路，且它漏掉了本报告里更严重的几条。**

### 8.1 已核实属实且此前遗漏（已修 1 条）

| 条目 | 位置 | 核实结论 |
|---|---|---|
| **B1 HTML 自动刷新必失败** | `server.js:160` `const INIT` vs `:246` `INIT=await r.json()` | **确凿真 bug**。浏览器里对 `const` 赋值抛 `TypeError`，被 `:247` 的 catch 吞掉 → 页面首屏正常，之后每 30 分钟静默失败，数字永远停在打开那一刻。**我上次读这段代码时漏了它** |
| **S3 PAT 永久留在 .git/config** | `tools/setup_github.py:84-102` | 属实。`push()` 先把 token 拼进 remote URL（`:91`），`:98` 的 `sys.exit` 在 `:100` 的 `set-url` **之前** → push 一失败明文 PAT 就落地；且 token 出现在 git 命令行参数里（进程列表可见） |
| **S4 公开分支泄露本机路径** | `src/providers/codex.js:68` `source: \`local ${dir} (approx)\`` | 属实，会把 `C:\Users\Shen\...` 写进公开的 `runtime-data/quotas.json`；`redact()` 只清了 title。本机未装 Codex 故暂不触发，但代码路径存在 |
| **P4 插件网络请求在 UI 线程** | `main.lua:502` `pcall(http.request, req)` | 属实，LuaSocket 的 `http.request` 是同步阻塞。manifest+image × 2 个端点 × 8s 超时 = 最坏 **32 秒界面冻结**（含"顶部下滑退出"都点不动） |
| **P6 同一份 PNG 哈希两次** | `main.lua:553` 与 `:554` | 属实，下载路径上 `sha(body)` 被调 2 次；纯 Lua SHA-256 在 PW3 上每次几十到上百毫秒 |
| **P3 新闻三源串行** | `src/providers/news.js:89-95` | 属实，`for` + `await` 串行，3 源 × 8s = 最坏 24s 才返回 dashboard |
| **P1 transcript 全量同步读** | `src/providers/claudecode.js:95` | 属实，`readFileSync(...).split('\n')` + 每行 `JSON.parse`，随时间只增不减 |
| **P8 上报 diff 判定恒为真** | `src/report-policy.js:3` | 属实，`now - previous.ts >= 5min` 与节流周期同长 → 每次都判"有变化"。实际频率由 Kindle 拉图节奏决定（30 分钟一次 → 一天 48 个 commit） |
| **S2 出图无 single-flight + 错误被吞** | `server.js:296-310` | 属实，`:309` 的空 `catch {}` 让渲染失败在日志里毫无痕迹（与本报告 #1 同源） |
| **S1 CORS 通配 + 默认 0.0.0.0** | `server.js:76`, `config.js:38` | 属实。`/api/dashboard` 含会话标题、持仓、城市，CORS `*` 意味着用户浏览器里打开的任意网页都能 `fetch` 走 |

### 8.2 必须否决 / 需要修正的建议

- **❌ "默认 host 改成 127.0.0.1" —— 不能照做。**
  Kindle 靠 `http://192.168.31.188:8787` 取图（局域网主链路），改默认值等于**让 Kindle 直接变黑屏**。
  正确做法：保留 `0.0.0.0`，但去掉 `ACAO: *`（HTML 页面同源，根本不需要 CORS），
  必要时加一个**可选**的 `DASH_TOKEN`；或在服务端按 `remoteAddress` 判断是否同网段再放行。
- **⚠️ P5 `http.TIMEOUT = 8` 的"全局副作用" —— 方向对，机制待实机确认。**
  LuaSocket 里 `socket.http.request` 实际读的是 `socket.TIMEOUT`，`http.TIMEOUT = 8` 可能只是给
  http 模块表加了个**无人读取**的字段（那就完全无效，超时仍是默认 60s！）。
  无论哪种，"用完恢复原值"都是对的；但必须先在设备上确认当前超时到底是 8 秒还是 60 秒。
- **⚠️ P7 额外整图解码 —— 部分夸大。**
  `main.lua:591` 的解码不只是为拿尺寸，还用来确认文件**真能解码**并与 manifest 交叉校验
  （`:597`）。但 `:576-578` 已经能从 PNG 头解析出宽高，可把头解析做下界检查、失败才解码。
- **⚠️ S5 "只读连接最坏阻塞 5 秒" —— 夸大。**
  WAL 模式下并发读不需要等写锁，busy timeout 主要影响写冲突。加 `timeout: 1000` 是无害加固，
  但不是"5 秒卡死"那种量级。

### 8.3 外部报告漏掉的（都是本报告里更严重的条目）

| 漏掉 | 为什么更严重 |
|---|---|
| **HTML 看板仍是旧"假额度"语义**（`server.js:219-227`） | 用户打开浏览器看到的是"WorkBuddy 限额 remaining/size"+"Claude/Codex 手写 cap"，与 PNG 版完全不一致 |
| **文档教人把 `cancel-in-progress` 改回 false**（`CLOUD_DEPLOY.md:29` / zh-CN:31） | 会精确复现 10-05 卡死 5 天的事故；代码里 render.yml:33 有"必须 true"的警告注释，文档却反着写 |
| **`/api/status` 无 try/catch + 无进程级兜底** | 一次 DB 结构变更即崩溃循环，Kindle 黑屏 |
| **英文版漏译**（`tr(' ·旧')` 键多前导空格、`tr('Codex 文件')` 无字典项） | 云端 stale 是常态 → 英文云端图基本必然混中文 |
| **`cache.js` 降级数据用完整 TTL / `lastOk` 无过期** | MLB 故障被固化 30 分钟；股票后缀回退被 stale 永久锁死 |

### 8.4 两份报告的交集（互相印证，可信度最高）

CORS 通配 + `0.0.0.0`；`hasPillow` 同步探测阻塞事件循环；`/api/display` 空 catch 吞错；
`claudecode.js` 全量读；`reporter.js` 把本机标识推到公开分支；`shouldUpload` 阈值与心跳周期混用。

### 8.5 已执行

**B1 已修**：`src/server.js:160` `const INIT` → `let INIT`（并加注释说明来由）；
`test/display_protocol.test.js` 新增防回归测试（断言 HTML 里是 `let INIT`、不是 `const INIT`、
且存在 `INIT = await r.json()` 赋值语句）。验证：Node 测试 27/27、eslint 通过、服务已重启，
并用 `vm` 抽取页面脚本实跑做了对照实验 —— `const INIT` → 出现"刷新失败"角标，`let INIT` → 正常。