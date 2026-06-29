# AI-LIS 第一版原型需求

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

## Windows 桌面端运行与打包说明

本项目在保留现有 GitHub Pages 静态网页版本的基础上，新增 Electron Windows 桌面端演示版能力。桌面版与网页版共用 `index.html` 作为入口，不接入后端服务；当前页面仍然使用模拟数据，暂不从本地数据库读取，请勿录入或使用真实患者信息。

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

- 当前桌面版仍然是静态演示原型，所有数据均为模拟数据。
- 桌面版不接入后端服务；当前页面暂不从本地数据库读取。
- 现有 GitHub Pages 网页版本继续使用同一个 `index.html`，无需通过 Electron 即可作为静态页面部署。

## 本地 SQLite 数据库初始化

TERRY-LIS 已新增本地 SQLite 数据库初始化能力，用于根据 `database/schema.sql` 和 `database/seed.sql` 生成桌面端可验证的本地数据库文件。当前页面数据仍然使用模拟数据，暂时不会从数据库读取。

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
- 下一步会逐步把页面中的模拟数据替换为数据库读取，但本次只新增数据库初始化能力。
- GitHub Pages 网页版本继续使用静态 `index.html`，不依赖本地 SQLite 数据库。

## 样本签收页面数据库驱动

Electron 桌面版样本签收页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `samples` 表读取样本签收数据，并用读取结果更新样本签收页面的统计卡片、样本列表、状态标签和右侧样本详情卡片。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此样本签收页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本在样本签收页面支持“确认签收”和“退样/拒收”真实写入。确认签收会把 `samples.status` 更新为 `reviewing`，写入 `received_at` / `updated_at`，并在 `audit_logs` 记录 `confirm_sample_reception` 审计日志；退样/拒收会把待签收样本更新为 `rejected`，写入 `reject_reason` / `updated_at`，并记录退样原因、操作者、原状态和新状态。

补采、标记异常、查看流转记录仍为演示按钮，不会修改数据库。后续会逐步加入补采任务等写入流程。

## AI 预审页面数据库驱动

Electron 桌面版 AI 预审页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `ai_pre_reviews`、`samples`、`test_results`、`test_items` 表读取 AI 预审数据，并用读取结果更新 A 类自动放行、B 类快速复核、C 类重点复核、风险预警等统计卡片，以及 AI 预审结果队列和右侧 AI 判定详情卡片。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此 AI 预审页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本仅实现 AI 预审数据读取，不实现自动放行、人工复核、转重点复核、人工覆盖等写入操作。页面中的相关按钮仍为原型演示交互，不会修改数据库。

后续会逐步加入 AI 预审状态更新、人工覆盖、审核动作和审计日志，让 AI 预审、人工审核与数据库留痕形成完整闭环。


## 危急值中心数据库驱动

Electron 桌面版危急值中心页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `critical_values`、`critical_notifications`、`samples`、`test_results`、`test_items` 表读取危急值与通知确认数据，并用读取结果更新危急值总览指标、处理队列、详情卡片、流程时间轴和通知与确认记录。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此危急值中心页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本仅实现危急值与通知数据读取，不实现通知确认、催办、闭环、归档等写入操作。页面中的确认已通知、记录电话通知、标记临床已确认、发起超时催办、升级提醒、完成闭环等按钮仍为原型演示交互，不会修改数据库。

后续会逐步加入危急值通知确认、超时催办、闭环处理和审计日志，让危急值识别、通知、确认、处置和归档形成完整可追溯流程。

## 质控看板数据库驱动

Electron 桌面版质控看板现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `instruments`、`qc_events`、`reagent_batches`、`reagent_expiry_alerts`、`test_items` 表读取质控数据，并用读取结果更新现有质控看板页面的统计卡片、质控事件队列、仪器状态看板、试剂近效期预警和批次风险列表。

本次修复补齐了 `qcDashboard:getData` IPC、`window.terryLisApi.getQcDashboardData()` preload API、`src/database/qcDashboard.js` 读取聚合逻辑，以及进入“质控看板”页面时的数据 hydration。质控看板不再在 Electron 桌面版中保留 `186`、`168`、`12`、`6` 等静态大数，而是映射为 SQLite seed 小数据：仪器数量来自 `instruments`，质控事件数量来自 `qc_events`，试剂批次数量来自 `reagent_batches`，试剂近效期预警与高风险试剂来自 `reagent_expiry_alerts`。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此质控看板会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本仅实现质控看板数据读取，不实现确认质控事件、暂停相关项目、生成复查任务、标记已校准、生成试剂更换提醒等写入操作。页面中的相关按钮仍为原型演示交互，不会修改数据库。

## 结果审核页面数据库驱动

Electron 桌面版结果审核页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `samples`、`test_results`、`test_items`、`ai_pre_reviews`、`result_reviews`、`users` 表读取结果审核数据，并用读取结果更新结果审核总览统计、结果审核队列和右侧结果详情 / AI 建议 / 审核留痕卡片。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此结果审核页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本仅实现结果审核数据读取，不实现确认发布、复检、暂缓发布、危急值标记等写入操作。页面中的确认发布、转重点复核、建议复检、暂缓发布、标记危急值等按钮仍为原型演示交互，不会修改数据库。

后续会逐步加入审核动作写入、结果状态更新、危急值触发和审计日志，让结果审核、危急值闭环和数据库留痕形成完整闭环。

## 系统设置页面数据库驱动

Electron 桌面版系统设置页面现在会优先通过安全的 preload / IPC 桥接，从本地 SQLite 数据库的 `users`、`roles`、`system_rules`、`audit_logs` 表读取用户、角色、系统规则和审计日志数据，并用读取结果更新系统设置总览指标、用户列表、角色权限列表、系统规则列表和最近审计日志列表。

GitHub Pages 网页版和普通浏览器环境没有 Electron API，也没有本地 SQLite 能力，因此系统设置页面会继续使用 `index.html` 中已有的静态 fallback 模拟数据；如果 Electron IPC 调用失败，页面同样会保留静态模拟数据并输出 `console.warn`，避免影响静态网页部署。

当前版本仅实现系统设置数据读取，不实现用户新增、权限修改、规则启停、配置保存等写入操作。页面中的新建规则、编辑规则、启用规则、暂停规则、提交审核、查看变更记录、导出审计日志、测试接口连接等按钮仍为原型演示交互，不会修改数据库。

后续会逐步加入用户权限管理、规则配置写入、审计日志落库和登录鉴权，让系统设置从只读治理台演进为可审计、可授权、可追溯的配置管理中心。
