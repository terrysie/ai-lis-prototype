-- TERRY-LIS demo seed data. All names and sample records are mock data.

INSERT INTO roles (id, role_name, description, status) VALUES
  (1, '审核技师', '查看 AI 预审、复核检验结果、处理危急值', 'active'),
  (2, '质控负责人', '维护仪器、质控、试剂和规则配置', 'active'),
  (3, '科室管理员', '查看全局运行概览与审计留痕', 'active');

INSERT INTO users (id, username, display_name, department, status) VALUES
  (1, 'reviewer_demo', '审核技师-模拟', '检验科', 'active'),
  (2, 'qc_demo', '质控负责人-模拟', '检验科', 'active'),
  (3, 'admin_demo', '科室管理员-模拟', '检验科', 'active');

INSERT INTO user_roles (user_id, role_id) VALUES
  (1, 1),
  (2, 2),
  (3, 3);

INSERT INTO samples (id, sample_no, patient_alias, department, specimen_type, status, priority, collected_at, received_at) VALUES
  (1, 'A-260611-1008', '模拟患者-001', '消化内科', '血清', '待复核', 'normal', '2026-06-11 08:16', '2026-06-11 08:42'),
  (2, 'A-260611-1042', '模拟患者-002', '急诊科', '血清', '危急值复核中', 'urgent', '2026-06-11 09:02', '2026-06-11 09:20'),
  (3, 'A-260611-1086', '模拟患者-003', '呼吸与危重症医学科', '全血', '快速复核', 'normal', '2026-06-11 08:48', '2026-06-11 09:15');

INSERT INTO test_items (id, item_code, item_name, category, unit, reference_range, critical_low, critical_high, status) VALUES
  (1, 'ALT', '丙氨酸氨基转移酶 ALT', '生化', 'U/L', '7-40', NULL, '>500', 'active'),
  (2, 'K', '血钾 K+', '生化', 'mmol/L', '3.5-5.3', '<2.8', '>6.2', 'active'),
  (3, 'WBC', '白细胞计数 WBC', '血常规', '10^9/L', '3.5-9.5', '<1.0', '>30.0', 'active');

INSERT INTO test_results (id, sample_id, test_item_id, result_value, result_unit, result_flag, result_status, measured_at) VALUES
  (1, 1, 1, '126', 'U/L', 'high', 'pending_review', '2026-06-11 10:20'),
  (2, 2, 2, '6.5', 'mmol/L', 'critical_high', 'critical_review', '2026-06-11 10:28'),
  (3, 3, 3, '18.2', '10^9/L', 'high', 'quick_review', '2026-06-11 10:35');

INSERT INTO ai_pre_reviews (id, sample_id, classification, conclusion, matched_rules, suggested_action, confidence) VALUES
  (1, 1, 'C', 'ALT Delta Check 超阈值，建议人工复核。', 'Delta Check 超阈值; 历史结果变化明显', '复核历史趋势后发布', 0.86),
  (2, 2, 'C', '血钾命中危急值上限且样本轻度溶血疑似。', '危急值规则 K+ > 6.2; 样本异常提示', '复检并完成危急值通知闭环', 0.93),
  (3, 3, 'B', '血常规异常但未达危急值，建议快速复核。', 'WBC 升高; 仪器散点图需浏览', '浏览散点图后快速审核', 0.78);

INSERT INTO result_reviews (id, test_result_id, reviewer_user_id, review_status, review_opinion, reviewed_at) VALUES
  (1, 1, 1, '处理中', '查看历史趋势，建议复核后发布', '2026-06-11 10:27'),
  (2, 2, 1, '已拦截', '危急值 + 样本异常，建议复检并通知', '2026-06-11 10:31');

INSERT INTO critical_values (id, test_result_id, critical_level, status, confirmed_by_user_id, confirmed_at) VALUES
  (1, 2, 'high', '已通知', 1, '2026-06-11 10:34');

INSERT INTO critical_notifications (id, critical_value_id, notify_target, notify_method, notify_status, notified_at, acknowledged_at, notes) VALUES
  (1, 1, '急诊科护士站', '电话', '已通知', '2026-06-11 10:36', NULL, '模拟电话通知记录，待临床确认');

INSERT INTO instruments (id, instrument_code, instrument_name, category, status, last_qc_at, next_calibration_at) VALUES
  (1, 'BA-02', '生化分析仪 BA-02', '生化', '正常', '2026-06-11 07:30', '2026-06-20 08:00'),
  (2, 'HA-01', '血常规 HA-01', '血常规', '关注', '2026-06-11 07:45', '2026-06-18 08:00'),
  (3, 'IA-03', '免疫 IA-03', '免疫', '限制', '2026-06-11 07:50', '2026-06-13 08:00');

INSERT INTO qc_events (id, instrument_id, event_type, event_level, status, event_time, description) VALUES
  (1, 1, '日间质控', 'info', '在控', '2026-06-11 07:35', '同批质控在控，自动放行规则可用'),
  (2, 2, '通道报警', 'warning', '关注', '2026-06-11 09:50', '白细胞通道重复报警 3 次，相关样本转 B/C 类');

INSERT INTO reagent_batches (id, batch_no, reagent_name, instrument_id, opened_at, expires_at, remaining_percent, status) VALUES
  (1, 'RB-ALT-260601', 'ALT 试剂批号 260601', 1, '2026-06-01 08:00', '2026-06-18 23:59', 42, '可用'),
  (2, 'RB-K-260602', '电解质试剂批号 260602', 1, '2026-06-02 08:00', '2026-06-14 23:59', 35, '临近效期');

INSERT INTO reagent_expiry_alerts (id, reagent_batch_id, alert_level, alert_message, status) VALUES
  (1, 2, 'warning', '电解质试剂 3 天内到期，建议安排更换与质控复查。', '待处理');

INSERT INTO infectious_alerts (id, sample_id, alert_type, alert_level, status, description) VALUES
  (1, 3, '感染相关风险', 'medium', '待复核', 'WBC 升高，AI 建议结合 CRP 与临床信息判断。');

INSERT INTO system_rules (id, rule_code, rule_name, rule_type, rule_config, status) VALUES
  (1, 'CRIT-K-HIGH', '血钾高值危急值规则', 'critical_value', '{"item":"K+","high":6.2,"notifyWithinMinutes":15}', 'enabled'),
  (2, 'DELTA-ALT', 'ALT Delta Check 规则', 'ai_pre_review', '{"item":"ALT","changePercent":100}', 'enabled'),
  (3, 'REAGENT-EXPIRY', '试剂效期预警规则', 'reagent', '{"warningDays":3,"highRiskDays":1}', 'enabled');

INSERT INTO audit_logs (id, actor, module, action, before_value, after_value, created_at) VALUES
  (1, 'AI 规则引擎', 'AI 预审', '自动分级为 C 类重点复核', NULL, 'A-260611-1008: C 类', '2026-06-11 10:24'),
  (2, '审核技师-模拟', '结果审核', '查看历史趋势', NULL, 'ALT 变化 +180%', '2026-06-11 10:27'),
  (3, 'AI 规则引擎', '危急值中心', '拦截自动发布', NULL, 'A-260611-1042: 危急值复核中', '2026-06-11 10:31');
