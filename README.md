# AI-LIS 第一版原型需求

## 当前推荐下载版本 / Latest RC

当前推荐试用版本为 **TERRY-LIS v0.5.0 RC 1**。

- Release URL: [https://github.com/terrysie/ai-lis-prototype/releases/tag/v0.5.0-rc.1](https://github.com/terrysie/ai-lis-prototype/releases/tag/v0.5.0-rc.1)
- Tag: `v0.5.0-rc.1`
- Commit: `b1edb575915ddc9528006fa21ebc1749c8d94674`
- 普通试用者建议下载 installer zip；需要免安装运行时下载 portable zip。
- 下载后建议先计算 SHA256，确认匹配后再运行。

| 资产 | 适用场景 | 大小 | SHA256 |
|---|---|---:|---|
| `TERRY-LIS-1.0.0-Windows-x64-installer.zip` | 推荐普通试用，解压后运行安装包 | 95,353,266 bytes | `EA757A5614111B8EE590EC7088BE324136DC977442A66FF34806E1F26B3FE3E6` |
| `TERRY-LIS-1.0.0-Windows-x64-portable.zip` | 免安装运行，解压后直接打开 | 138,331,640 bytes | `3EFFBB6C158089EDADE8603957326311491F349FDCEC5C84DDAF791396138AD6` |

## v0.5 RC 1 当前能力

当前 v0.5 RC 1 已经不是单纯静态页面，而是 Electron Windows 桌面端 demo。它使用本地 SQLite 数据库驱动部分页面、统计和真实写入闭环，同时保留普通浏览器 / GitHub Pages 环境下的静态 fallback。

已验证能力包括：

- 样本接收写入闭环：确认签收、退样/拒收、补采任务创建和流转记录读取。
- 结果审核写入闭环：审核通过、审核退回和 `audit_logs` 留痕。
- 危急值闭环：通知、临床确认、完成闭环和审计记录。
- 报告生成 / 导出 / 发布最小闭环：HTML 报告生成、本地 HTML 导出、正式发布和审计记录。
- 系统规则编辑 / 启停：规则配置值修改、规则状态启停和审计记录。
- 质控事件处理：处理措施、处理人、处理时间、状态和审计记录。
- 试剂近效期预警处理：处理措施、状态更新和审计记录。
- 传染病阳性预警处理：复核、通知、院感跟进、报告提示状态更新和审计记录。
- v0.5 权限治理：UI gating、main action guard、敏感操作覆盖清单、`demo_operator` 边界提示。

## v0.5 RC 1 验证状态

已完成以下验证：

- `db:reset` 通过。
- `db:check` 通过。
- 10 个 smoke 全部通过：
  - `smoke:sample-reception`
  - `smoke:result-review`
  - `smoke:critical-values`
  - `smoke:e2e-workflow`
  - `smoke:report-output`
  - `smoke:report-publish`
  - `smoke:system-rules`
  - `smoke:qc-events`
  - `smoke:reagent-expiry-alerts`
  - `smoke:infectious-alerts`
- `node --check .\main.js` 通过。
- Electron 开发模式人工检查通过。
- 本地构建后的免安装版运行正常。
- 本地构建后的安装包安装 / 运行正常。
- GitHub Release 页面两个资产已确认。
- 从 GitHub Release 下载两个 zip 后 SHA256 完全匹配。
- 下载版 portable 解压 / 运行正常。
- 下载版 installer 解压 / 安装 / 运行正常。

## 重要限制

- 当前仍是 desktop demo，不是生产级医疗 LIS。
- 不用于真实患者生产环境。
- 不连接真实医院 HIS / LIS / EMR。
- 不连接真实检验仪器。
- `demo_operator` 仅用于演示，不是生产权限角色。
- UI gating 只是前端提示与确认，不等于真实安全认证。
- main action guard 是 main 层最小入口保护，不等于完整生产授权体系。
- `reportPrint` 当前无真实后端打印动作。
- `systemRuleCreate` 当前只是 UI 预留，不新增真实写入。

## 早期 V1 原型历史需求

以下内容保留为早期 V1 原型需求记录；当前可试用版本请以上方 v0.5 RC 1 说明为准。

这是一个 AI-LIS 实验室信息管理系统原型，面向单实验室 / 单院区。

第一版先做静态前端原型，不接入真实医院系统，不使用真实患者信息，不需要后端和数据库。

V1 核心展示三件事：

1. 智能预审 / 自动放行
2. 危急值自动闭环
3. 内部智能助手

AI 不替代最终医疗责任人，只做筛选、解释、催办、排序。

第一版页面包括：

- 审核技师工作台
- 样本流转概览
- AI 预审队列
- AI 判定卡片
- 危急值中心
- 内部智能助手

AI 判定卡片必须采用：

1. 结论
2. 命中规则
3. 建议动作

技术要求：

- 使用 HTML、CSS、JavaScript
- 代码先写在 index.html
- 所有数据使用模拟数据
- 保持 GitHub Pages 可部署

## v0.4 Release Candidate

v0.4 RC 是“报告与系统可用性阶段”的候选说明，对应 Windows 桌面端可运行候选版本。当前已验证主流程写入闭环、报告发布、系统规则、质控事件、试剂近效期预警和传染病阳性预警处理，并已通过十个 smoke；本地 Windows 免安装版和 NSIS 安装包也已完成运行验证。

当前版本不是正式医疗生产系统。`dist` 目录是本地打包产物，不提交到 Git。详细能力、限制和下一阶段计划见 [docs/v0.4-rc-notes.md](docs/v0.4-rc-notes.md)。

## Windows 桌面端运行与打包说明

本项目在保留现有 GitHub Pages 静态网页版本的基础上，提供 Electron Windows 桌面端演示版能力。桌面版与网页版共用 `index.html` 作为入口；当前桌面 demo 使用本地 SQLite 数据库驱动部分页面、统计和写入闭环，但仍不接入真实医院系统，不使用真实患者信息。

### 安装依赖

```bash
npm install
```

### 本地运行桌面版

```bash
npm start
```

Electron 将加载本地 `index.html`，以桌面窗口形式运行 TERRY-LIS 实验室信息管理系统原型。

### 打包 Windows 版本

```bash
npm run build
```

打包工具使用 `electron-builder`，应用名称为 `TERRY-LIS`，Windows 安装包文件名中会包含 `TERRY-LIS`。

### 打包产物位置

```text
dist/
```

### 数据与部署说明

- 当前桌面 demo 使用本地 SQLite 数据库驱动部分页面、统计和写入闭环；普通浏览器 / GitHub Pages 环境继续使用静态 fallback。
- 桌面版不接入真实医院 HIS / LIS / EMR，不接入真实检验仪器，不使用真实患者信息。
- `dist` 是本地打包产物，不提交到 Git。
- 现有 GitHub Pages 网页版本继续使用同一个 `index.html`，无需通过 Electron 即可作为静态页面部署。

## 本地 SQLite 数据库初始化

TERRY-LIS 已新增本地 SQLite 数据库初始化能力，用于根据 `database/schema.sql` 和 `database/seed.sql` 生成桌面端可验证的本地数据库文件。当前 Electron 桌面端会通过安全的 preload / IPC 桥接读取 SQLite，并驱动部分页面、统计和真实写入闭环；普通浏览器环境继续使用静态 fallback。

### 初始化数据库

```bash
npm run db:init
```

该命令会检查本地数据库文件是否存在：

- 如果数据库文件不存在，会创建数据库，并依次执行 `database/schema.sql` 与 `database/seed.sql`。
- 如果数据库文件已存在，会跳过初始化，不会重复导入 `seed.sql`。

### 重置数据库

```bash
npm run db:reset
```

该命令会删除旧的本地数据库文件，然后重新执行初始化流程。适合在调整演示数据或需要恢复初始状态时使用。

### 检查数据库

```bash
npm run db:check
```

该命令会检查数据库文件是否存在，并输出 `users`、`roles`、`samples`、`test_items`、`test_results`、`ai_pre_reviews`、`result_reviews`、`critical_values`、`critical_notifications`、`instruments`、`qc_events`、`reagent_batches`、`reagent_expiry_alerts`、`infectious_alerts`、`system_rules`、`audit_logs` 等核心表的数据数量。

### 数据库文件位置

通过命令行脚本初始化时，数据库默认生成在：

```text
data/terry-lis.sqlite
```

Electron 桌面端启动时也会自动初始化本地数据库。桌面端会优先使用 Electron 的用户数据目录保存数据库，以避免写入安装目录；如需指定数据库路径，可以设置环境变量 `TERRY_LIS_DB_PATH`。


## 工作台首页数据库驱动

Electron 桌面版启动时会优先通过安全的 preload / IPC 桥接读取本地 SQLite 数据库，并用数据库统计结果更新工作台首页的核心统计卡片。当前接入的首页指标包括：今日接收样本、AI 可自动放行、快速复核、重点复核、未闭环危急值。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此首页会继续保留 `index.html` 中的静态模拟数字作为 fallback；如果 Electron IPC 调用失败，页面也会降级保留静态模拟数据并输出 `console.warn`。

当前统计逻辑仍基于 `database/seed.sql` 中的模拟 seed 数据：样本日期为原型演示日期时，首页“今日接收样本”会在没有真实今日数据的情况下回退为样本总数。后续会继续把样本签收、AI 预审、结果审核、危急值中心、质控看板等页面逐步接入数据库。

### 数据声明

- 当前数据库仍然只使用原型模拟数据，不包含真实患者信息。
- 请勿在本地数据库中录入或保存真实患者姓名、身份证号、电话、住址等敏感信息。
- 当前 Electron 桌面端已将部分页面、统计和写入动作接入本地 SQLite；未接入的按钮和普通浏览器环境仍使用静态 fallback 或原型提示。
- GitHub Pages 网页版本继续使用静态 `index.html`，不依赖本地 SQLite 数据库。

## 样本签收页面数据库驱动

Electron 桌面版样本签收页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `samples` 表读取样本签收数据，并用读取结果更新样本签收页面的统计卡片、样本列表、状态标签和右侧样本详情卡片。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此样本签收页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本在样本签收页面支持“确认签收”、“退样/拒收”、“生成补采任务”和“流转记录 / 操作历史”读取。确认签收会把 `samples.status` 更新为 `reviewing`，写入 `received_at` / `updated_at`，并在 `audit_logs` 记录 `confirm_sample_reception` 审计日志；退样/拒收会把待签收样本更新为 `rejected`，写入 `reject_reason` / `updated_at`，并记录退样原因、操作者、原状态和新状态；生成补采任务会写入 `sample_recollection_tasks`，并在 `audit_logs` 记录补采原因、操作者、样本编号、样本原状态和任务状态。样本详情区会按当前样本读取相关 `audit_logs`，补采任务日志会通过 `before_json` / `after_json` 中的样本信息关联回来。

标记异常仍为演示按钮，不会修改数据库。后续会逐步加入更多样本流转写入流程。

`npm run smoke:sample-reception` 会覆盖样本接收模块的确认签收、退样/拒收、补采任务写入，以及对应流转记录读取验证。

## AI 预审页面数据库驱动

Electron 桌面版 AI 预审页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `ai_pre_reviews`、`samples`、`test_results`、`test_items`、`infectious_alerts` 表读取 AI 预审和传染病阳性预警数据，并用读取结果更新 A 类自动放行、B 类快速复核、C 类重点复核、风险预警等统计卡片、AI 预审结果队列、右侧 AI 判定详情卡片和传染病阳性预警列表。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此 AI 预审页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本支持“处理传染病预警”真实写入。操作会更新 `infectious_alerts` 的复核、通知、院感跟进、报告提示状态和更新时间，并在 `audit_logs` 记录“处理传染病阳性预警”；自动放行、人工复核、转重点复核、人工覆盖等其它 AI 预审按钮仍为原型演示交互。

`npm run smoke:infectious-alerts` 用于验证传染病阳性预警处理写入、非法处理失败、重复处理失败，以及 `audit_logs` 记录传染病阳性预警处理。该脚本不修改 `database/schema.sql` 或 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。

后续会逐步加入 AI 预审状态更新、人工覆盖、审核动作和审计日志，让 AI 预审、人工审核与数据库留痕形成完整闭环。


## 危急值中心数据库驱动

Electron 桌面版危急值中心页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `critical_values`、`critical_notifications`、`samples`、`test_results`、`test_items` 表读取危急值与通知确认数据，并用读取结果更新危急值总览指标、处理队列、详情卡片、流程时间轴和通知与确认记录。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此危急值中心页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本支持“确认已通知”“标记临床已确认”“完成闭环”三类真实写入操作。操作会更新 `critical_notifications` 和 `critical_values` 的现有状态字段，并在 `audit_logs` 记录“危急值通知”“危急值确认”“危急值完成”。`npm run smoke:critical-values` 会覆盖这三类写入、重复操作失败、缺失通知 ID 失败和审计日志写入验证。

当前版本不实现报告发布、临床系统接口、短信电话真实发送、催办升级等外部联动。页面中的记录电话通知、发起超时催办、升级提醒、查看完整留痕等按钮仍为原型演示交互，不会修改数据库。

## 质控看板数据库驱动

Electron 桌面版质控看板现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `instruments`、`qc_events`、`reagent_batches`、`reagent_expiry_alerts`、`test_items` 表读取质控数据，并用读取结果更新现有质控看板页面的统计卡片、质控事件队列、仪器状态看板、试剂近效期预警和批次风险列表。

本次修复补齐了 `qcDashboard:getData` IPC、`window.terryLisApi.getQcDashboardData()` preload API、`src/database/qcDashboard.js` 读取聚合逻辑，以及进入“质控看板”页面时的数据 hydration。质控看板不再在 Electron 桌面版中保留 `186`、`168`、`12`、`6` 等静态大数，而是映射为 SQLite seed 小数据：仪器数量来自 `instruments`，质控事件数量来自 `qc_events`，试剂批次数量来自 `reagent_batches`，试剂近效期预警与高风险试剂来自 `reagent_expiry_alerts`。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此质控看板会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本支持“确认质控事件”真实写入。操作会更新 `qc_events` 的处理状态、处理措施、处理人和处理时间，并在 `audit_logs` 记录“处理质控事件”；暂停相关项目、生成复查任务、标记已校准、生成试剂更换提醒等操作仍为原型演示交互。

`npm run smoke:qc-events` 用于验证质控事件处理写入、非法处理失败、重复处理失败，以及 `audit_logs` 记录质控事件处理。该脚本不修改 `database/schema.sql` 或 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。

当前版本也支持“处理近效期预警”真实写入。操作会更新 `reagent_expiry_alerts` 的预警状态、处理措施和更新时间，并在 `audit_logs` 记录“处理试剂近效期预警”。`npm run smoke:reagent-expiry-alerts` 用于验证试剂近效期预警处理写入、非法处理失败、重复处理失败，以及审计日志写入；该脚本不修改 `database/schema.sql` 或 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。

## 结果审核页面数据库驱动

Electron 桌面版结果审核页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `samples`、`test_results`、`test_items`、`ai_pre_reviews`、`result_reviews`、`users` 表读取结果审核数据，并用读取结果更新结果审核总览统计、结果审核队列和右侧结果详情 / AI 建议 / 审核留痕卡片。

结果审核页面现在支持“审核通过”和“驳回/退回修改”真实写入。操作会更新 `result_reviews` 和关联 `test_results.result_status`，并在 `audit_logs` 记录“审核通过”或“审核驳回”。`npm run smoke:result-review` 会覆盖这两类写入、重复操作失败、缺失审核 ID 失败和审计日志写入验证。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此结果审核页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本不实现报告正式发布、复检、危急值标记等写入操作。页面中的转重点复核、建议复检、标记危急值等按钮仍为原型演示交互，不会修改数据库。

后续会逐步加入审核动作写入、结果状态更新、危急值触发和审计日志，让结果审核、危急值闭环和数据库留痕形成完整闭环。

## v0.3 主流程端到端 smoke

`npm run smoke:e2e-workflow` 用于验证 v0.3 主流程写入闭环，覆盖样本接收确认、结果审核通过、危急值通知、危急值临床确认、危急值完成闭环和 `audit_logs` 追溯。

当前 seed 没有同一个待签收样本同时关联待审核结果和待处理危急值通知，因此该 smoke 会在 `db:reset` 后按现有 schema 构造一条 `E2E-SMOKE` 运行时测试链路；它不修改 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。

## v0.4 报告输出最小闭环

`npm run smoke:report-output` 用于验证报告预览数据读取、可打印 HTML 报告生成、本地 HTML 文件导出、未审核结果拒绝生成报告，以及 `audit_logs` 记录“生成报告HTML”动作。

当前 seed 没有 `approved + reviewed` 的报告输出基线结果时，该 smoke 会按现有 schema 构造一条 `REPORT-SMOKE` 运行时测试数据；它不修改 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。导出的 smoke HTML 文件会在脚本结束前删除。

`npm run smoke:report-publish` 用于验证已审核结果可正式发布、发布后 `test_results.result_status = published`、`audit_logs` 记录“发布报告”、重复发布失败、未审核结果不能发布，以及已发布结果仍可生成 HTML 报告。当前 seed 没有 `approved + reviewed` 的发布基线结果时，该 smoke 会构造 `PUBLISH-SMOKE` 运行时测试数据；它不修改 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。

## 系统设置页面数据库驱动

Electron 桌面版系统设置页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `users`、`roles`、`system_rules`、`audit_logs` 表读取用户、角色、系统规则和审计日志数据，并用读取结果更新系统设置总览指标、用户列表、角色权限列表、系统规则列表和最近审计日志列表。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此系统设置页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本支持 `system_rules` 规则配置值修改和规则启停写入，并会记录 `audit_logs`；用户新增、权限修改、提交审核、查看变更记录、导出审计日志、测试接口连接等操作仍为原型演示交互。

`npm run smoke:system-rules` 用于验证系统设置规则写入、非法更新失败、`audit_logs` 记录规则更新；当前 schema 支持 `status` 启停字段，因此 smoke 也会验证规则启停。该脚本不修改 `database/schema.sql` 或 `database/seed.sql`，后续执行 `npm run db:reset` 会恢复基线数据。
