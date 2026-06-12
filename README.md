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

本项目在保留现有 GitHub Pages 静态网页版本的基础上，新增 Electron Windows 桌面端演示版能力。桌面版与网页版共用 `index.html` 作为入口，不接入后端服务，不接入数据库，当前仍然使用模拟数据，请勿录入或使用真实患者信息。

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
- 桌面版不接入后端服务，不接入数据库。
- 现有 GitHub Pages 网页版本继续使用同一个 `index.html`，无需通过 Electron 即可作为静态页面部署。

## 本地 SQLite 数据库初始化

项目新增本地 SQLite 初始化能力，用于根据 `database/schema.sql` 和 `database/seed.sql` 生成演示数据库文件。当前数据库仍然只包含模拟数据，不包含真实患者信息；页面数据也暂时仍来自 `index.html` 中的模拟数据，下一步会逐步替换为数据库读取。

### 初始化数据库

```bash
npm run db:init
```

该命令会在数据库文件不存在时创建本地 SQLite 数据库，并执行 `database/schema.sql` 与 `database/seed.sql`。如果数据库文件已经存在，不会重复导入 seed 数据。

### 重置数据库

```bash
npm run db:reset
```

该命令会删除旧的本地数据库文件，并重新执行 schema 与 seed，适合需要恢复演示初始数据时使用。

### 检查数据库

```bash
npm run db:check
```

该命令会检查数据库文件是否存在，并输出 users、roles、samples、test_items、test_results、ai_pre_reviews、result_reviews、critical_values、critical_notifications、instruments、qc_events、reagent_batches、reagent_expiry_alerts、infectious_alerts、system_rules、audit_logs 等核心表的数据数量。

### 数据库文件位置

- 开发环境命令行默认生成在项目根目录：`data/terry-lis-demo.sqlite`。
- Electron 桌面版运行时优先生成在系统用户数据目录：`app.getPath("userData")/terry-lis-demo.sqlite`，例如 TERRY-LIS 用户数据目录下的 `terry-lis-demo.sqlite`。
- `data/` 目录与 `*.sqlite` 文件属于运行产物，已加入 `.gitignore`，不应提交到代码仓库。
