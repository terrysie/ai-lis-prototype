# TERRY-LIS 第一版数据库设计

本文件记录 TERRY-LIS 演示原型的第一版本地数据库设计。当前数据库仅用于本地演示、初始化验证和后续逐步替换页面模拟数据，不包含真实患者信息。

## 核心表

- `users`：模拟系统用户。
- `roles` / `user_roles`：模拟角色与用户角色关系。
- `samples`：模拟样本主记录。
- `test_items`：模拟检验项目字典。
- `test_results`：模拟检验结果。
- `ai_pre_reviews`：AI 预审分级、规则命中和建议动作。
- `result_reviews`：人工审核记录。
- `critical_values` / `critical_notifications`：危急值及通知闭环。
- `instruments` / `qc_events`：仪器与质控事件。
- `reagent_batches` / `reagent_expiry_alerts`：试剂批次与效期预警。
- `infectious_alerts`：感染相关提醒。
- `system_rules`：系统规则配置。
- `audit_logs`：审计留痕。

## 本地 SQLite 初始化流程

项目使用 `sql.js` 作为纯 JS / WASM SQLite 方案，避免 Windows 环境安装 native SQLite 依赖时触发 node-gyp 或本地编译工具链问题。

初始化流程如下：

1. `src/database/initDatabase.js` 读取 `database/schema.sql` 和 `database/seed.sql`。
2. 开发环境命令行默认在项目根目录的 `data/terry-lis-demo.sqlite` 生成数据库文件。
3. Electron 运行时由 `main.js` 传入 `app.getPath("userData")`，数据库优先生成在系统用户数据目录下，例如 `TERRY-LIS/terry-lis-demo.sqlite`。
4. 如果数据库文件不存在，初始化模块会创建 SQLite 数据库并依次执行 schema 与 seed。
5. 如果数据库文件已经存在，初始化模块只复用现有文件，不会重复导入 seed 数据。
6. `resetDatabase` 会删除旧数据库文件并重新执行 schema 与 seed。
7. `checkDatabase` 会检查数据库是否存在，并输出核心表的数据数量。

当前页面仍继续使用 `index.html` 内的模拟数据，尚未改为从 SQLite 读取。后续迭代会逐步把页面模拟数据替换为数据库读取。
