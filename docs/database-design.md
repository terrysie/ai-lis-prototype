# TERRY-LIS 第一版数据库设计

> 当前设计用于 TERRY-LIS 实验室信息管理系统原型的第一阶段数据库落地。该设计只承载演示与后续开发验证，不接入真实医院系统，不保存真实患者信息。

## 1. 数据库设计目标

第一版数据库的目标是把当前页面中的模拟数据抽象为可持续演进的数据结构，为后续逐步替换前端静态数据做准备：

- 支撑工作台首页的待办统计、风险提示和模块概览。
- 支撑样本签收、样本退收、样本状态流转。
- 支撑 AI 预审的风险等级、命中规则、建议动作和人工覆盖。
- 支撑结果审核的人工复核、放行、退回、暂挂等记录。
- 支撑危急值中心的触发、通知、确认和闭环跟踪。
- 支撑质控看板的仪器状态、质控事件和影响范围展示。
- 支撑系统设置中的角色权限、规则版本和规则启停。
- 支撑传染病阳性预警、试剂近效期预警和审计留痕。

## 2. 为什么先使用 SQLite 兼容结构

当前项目仍是前端与 Electron 桌面端共用 `index.html` 的原型阶段，尚未引入后端服务。SQLite 兼容结构适合作为第一阶段数据库方案，原因包括：

1. **部署成本低**：桌面端可以随应用携带本地数据库文件，无需单独安装数据库服务。
2. **适合原型验证**：可以快速验证样本、结果、AI 预审、审核和预警之间的数据关系。
3. **方便测试和演示**：`schema.sql` 与 `seed.sql` 可以在本地一键初始化演示数据。
4. **保留迁移空间**：JSON 字段先用 `text` 保存，状态字段也使用 `text`，后续迁移到 PostgreSQL 时可以转换为 `jsonb`、枚举或约束表。

## 3. 后续如何迁移到 PostgreSQL

后续接入真实业务环境时，建议按以下路径迁移：

1. **类型增强**
   - 将 `permissions_json`、`risk_tags_json`、`hit_rules_json`、`rule_config_json`、`before_json`、`after_json` 从 `text` 转为 `jsonb`。
   - 将 `created_at`、`updated_at`、`reported_at`、`reviewed_at`、`triggered_at` 等时间字段转为 `timestamp with time zone`。
2. **约束增强**
   - 将关键状态字段从自由文本逐步迁移为枚举、字典表或检查约束。
   - 为样本号、仪器编码、项目编码、事件编号等业务唯一字段增加更严格的唯一约束。
3. **审计与合规增强**
   - 将审计日志按月份或业务模块分区。
   - 对涉及接口请求、结果修改、规则审批、危急值闭环的审计记录增加不可篡改策略。
4. **接口与集成增强**
   - 增加 HIS / EMR / 仪器中间件的外部编码字段和同步任务表。
   - 对接真实身份认证、院内用户目录和权限系统。
5. **性能优化**
   - 根据真实查询增加组合索引、物化视图或读模型表。
   - 针对工作台首页统计建立汇总表或定时刷新机制。

## 4. 核心表作用

| 表名 | 作用 |
| --- | --- |
| `roles` | 保存系统角色、权限 JSON 和角色状态，支撑系统设置与权限控制。 |
| `users` | 保存用户账号、显示名、所属角色、科室和状态。 |
| `samples` | 保存样本主数据，包括样本号、患者演示编码、来源、科室、检验组、采集时间、签收时间、状态和优先级。 |
| `test_items` | 保存检验项目字典，包括项目编码、名称、单位、参考范围和危急值阈值。 |
| `test_results` | 保存检验结果，关联样本、项目和仪器，记录结果值、异常标志、危急标志、质控状态和结果状态。 |
| `ai_pre_reviews` | 保存 AI 预审记录，记录风险等级、风险标签、命中规则、结论、建议动作和人工覆盖状态。 |
| `result_reviews` | 保存人工审核记录，记录审核状态、审核人、审核意见、审核动作和审核时间。 |
| `critical_values` | 保存危急值主记录，记录触发项目、结果、阈值、负责医生、状态和闭环时间。 |
| `critical_notifications` | 保存危急值通知记录，记录通知方式、对象、通知人、确认状态和备注。 |
| `instruments` | 保存仪器基础信息、所属专业组、在线状态、校准时间和质控时间。 |
| `qc_events` | 保存质控事件，关联仪器和项目，记录触发规则、影响范围、建议动作和处理人。 |
| `reagent_batches` | 保存试剂批次、批号、关联项目、关联仪器、启用时间、有效期和库存。 |
| `reagent_expiry_alerts` | 保存试剂近效期预警，关联试剂批次，记录剩余天数、风险等级和处理建议。 |
| `infectious_alerts` | 保存传染病阳性预警，关联样本和结果，记录阳性条件、复核、通知、院感跟进和上报提示状态。 |
| `system_rules` | 保存系统规则配置，包括 AI 预审、危急值、传染病预警、试剂近效期预警等规则。 |
| `audit_logs` | 保存审计日志，记录操作人、模块、操作类型、目标表、目标 ID、前后数据快照和备注。 |

## 5. 核心数据关系

### 5.1 样本与结果

- `samples` 是样本主表，一个样本可以关联多条 `test_results`。
- `test_results.test_item_id` 指向 `test_items.id`，用于解释项目名称、单位、参考范围和危急值阈值。
- `test_results.instrument_id` 指向 `instruments.id`，用于追踪结果由哪台仪器产生。

### 5.2 结果、AI 预审与人工审核

- `ai_pre_reviews` 同时关联 `sample_id` 和 `result_id`，用于保存某个结果的 AI 判断。
- `result_reviews` 同时关联 `sample_id` 和 `result_id`，用于保存人工审核动作。
- 页面中的 AI 判定卡片可以来自 `ai_pre_reviews.conclusion`、`hit_rules_json` 和 `suggested_action`。
- 页面中的审核队列可以联合查询 `samples`、`test_results`、`ai_pre_reviews` 和 `result_reviews`。

### 5.3 危急值闭环

- 当 `test_results.critical_flag` 为危急状态时，可以生成 `critical_values`。
- `critical_values` 记录危急值主状态，例如已触发、已通知、已确认、已关闭。
- `critical_notifications` 记录每一次电话、系统消息或其他方式的通知明细。
- 审计日志记录危急值通知、确认、修改和关闭动作，便于追溯。

### 5.4 质控与结果影响

- `instruments` 记录仪器当前状态和最近质控时间。
- `qc_events` 关联仪器和检验项目，记录质控事件对结果范围的影响。
- `test_results.qc_status` 可用于标识某个结果是否通过质控、是否受质控事件影响。
- 质控看板可以从 `instruments` 与 `qc_events` 获取仪器状态、事件数量、事件等级和处理建议。

### 5.5 试剂近效期预警

- `reagent_batches` 记录试剂批次、有效期、库存和关联仪器 / 项目。
- `reagent_expiry_alerts` 记录剩余天数、风险等级和建议动作。
- 试剂预警可以与 `system_rules` 中的近效期规则联动，按 30 天、7 天等阈值生成不同风险等级。

### 5.6 传染病阳性预警

- `infectious_alerts` 关联样本和结果，用于记录阳性条件、复核状态、通知状态、院感跟进状态和上报提示状态。
- 传染病阳性预警通常由 `test_results` 的阳性结果和 `system_rules` 中的传染病规则共同触发。
- 页面可以根据 `deadline_at` 显示处置倒计时或超时风险。

## 6. 后续需要对接 HIS / EMR / 仪器接口的字段

后续进入真实集成阶段时，以下字段需要重点与院内系统或仪器接口映射：

### HIS / EMR 相关

- `samples.patient_code`：当前为演示患者编码，未来需映射 HIS / EMR 患者主索引或就诊号。
- `samples.source_type`：需映射门诊、住院、急诊、体检等来源。
- `samples.department`：需映射院内科室编码和科室名称。
- `samples.collected_at`、`samples.received_at`：需对接采样时间、送检时间、签收时间。
- `critical_values.responsible_doctor`：未来应改为医生编码、医生姓名、科室和联系方式等结构化字段。
- `infectious_alerts.notify_status`、`infection_control_status`、`report_hint_status`：需与院感、上报或院内消息系统联动。

### 仪器 / 中间件相关

- `instruments.instrument_code`：需映射仪器中间件或厂商设备编码。
- `test_items.item_code`：需映射 LIS 项目编码、仪器项目编码和医院收费项目编码。
- `test_results.result_value`、`result_text`、`unit`、`reference_range`：需接收仪器结果、人工复核结果和报告展示结果。
- `test_results.instrument_id`：需标识结果来源仪器。
- `test_results.qc_status`：需与质控系统或仪器质控状态同步。
- `qc_events.event_no`、`trigger_rule`、`impact_scope`：需承载仪器质控规则、中间件事件编号和影响结果范围。
- `reagent_batches.batch_no`、`enabled_at`、`expires_at`、`stock_qty`：需与试剂管理、仪器装载信息或库存系统同步。

### 规则与权限相关

- `roles.permissions_json`：未来可对接统一身份认证或权限平台。
- `system_rules.rule_config_json`：未来应与规则发布、审批、回滚流程对接。
- `audit_logs.user_id`：未来应关联真实登录用户与电子签名身份。

## 7. 为什么必须保留审计日志

审计日志是 LIS 系统的基础能力，必须从原型阶段就保留：

1. **医疗安全追溯**：结果修改、审核、放行、危急值通知都需要可追溯。
2. **责任边界清晰**：AI 只提供辅助判断，最终审核动作仍需要记录人工责任人。
3. **规则治理需要证据**：危急值规则、AI 预审规则、传染病预警规则的启停和审批必须留痕。
4. **接口问题定位**：后续对接 HIS / EMR / 仪器后，审计日志可帮助定位数据同步异常。
5. **合规与内控要求**：检验报告、危急值闭环和院感提示均可能涉及监管检查和院内质控。

## 8. 原型数据库声明

当前数据库设计仍属于原型数据库设计：

- 不接入真实医院 HIS / EMR / 仪器系统。
- 不保存真实患者姓名、身份证号、电话、住址等个人敏感信息。
- `patient_code`、医生姓名、科室通知对象均为演示字段或演示数据。
- 当前 SQL 文件用于结构评审、桌面端本地验证和后续后端接口设计，不应直接用于生产环境。

## 9. 对当前页面模块的支撑关系

| 页面模块 | 主要数据来源 |
| --- | --- |
| 工作台首页 | `samples`、`test_results`、`ai_pre_reviews`、`critical_values`、`qc_events`、`reagent_expiry_alerts`、`infectious_alerts` |
| 样本签收 | `samples`、`users`、`audit_logs` |
| AI 预审 | `ai_pre_reviews`、`samples`、`test_results`、`test_items`、`system_rules` |
| 结果审核 | `result_reviews`、`test_results`、`samples`、`users` |
| 危急值中心 | `critical_values`、`critical_notifications`、`test_results`、`samples` |
| 质控看板 | `instruments`、`qc_events`、`test_items`、`test_results` |
| 系统设置 | `users`、`roles`、`system_rules`、`test_items`、`instruments` |
| 传染病阳性预警 | `infectious_alerts`、`test_results`、`samples`、`system_rules` |
| 试剂近效期预警 | `reagent_batches`、`reagent_expiry_alerts`、`test_items`、`instruments` |
| 审计留痕 | `audit_logs`、`users` |
