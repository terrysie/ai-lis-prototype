-- TERRY-LIS 数据库第一版模拟数据
-- 注意：所有样本号、患者编码、医生姓名均为原型演示数据，不代表真实患者信息。

PRAGMA foreign_keys = ON;

INSERT INTO roles (id, role_name, description, permissions_json, status, created_at, updated_at) VALUES
  (1, 'admin', '系统管理员，维护规则、用户、权限和基础字典。', '{"modules":["workbench","sample_receive","ai_review","result_review","critical_value","qc","settings","audit"],"actions":["read","write","approve"]}', 'active', '2026-06-01 08:00:00', '2026-06-01 08:00:00'),
  (2, 'reviewer', '审核技师，负责 AI 预审后的人工确认、复核和放行。', '{"modules":["workbench","ai_review","result_review","critical_value","qc"],"actions":["read","review","release"]}', 'active', '2026-06-01 08:00:00', '2026-06-01 08:00:00'),
  (3, 'receiver', '样本签收人员，负责样本接收、退收和流转登记。', '{"modules":["workbench","sample_receive"],"actions":["read","receive","reject"]}', 'active', '2026-06-01 08:00:00', '2026-06-01 08:00:00'),
  (4, 'qc_manager', '质控负责人，处理仪器质控事件和试剂预警。', '{"modules":["workbench","qc","reagent_alert"],"actions":["read","handle","close"]}', 'active', '2026-06-01 08:00:00', '2026-06-01 08:00:00');

INSERT INTO users (id, username, display_name, role_id, department, status, created_at, updated_at) VALUES
  (1, 'terry.admin', '系统管理员', 1, '检验科', 'active', '2026-06-01 08:10:00', '2026-06-01 08:10:00'),
  (2, 'chen.review', '陈审核', 2, '生化组', 'active', '2026-06-01 08:10:00', '2026-06-01 08:10:00'),
  (3, 'li.receive', '李签收', 3, '样本接收室', 'active', '2026-06-01 08:10:00', '2026-06-01 08:10:00'),
  (4, 'wang.qc', '王质控', 4, '免疫组', 'active', '2026-06-01 08:10:00', '2026-06-01 08:10:00');

INSERT INTO samples (id, sample_no, patient_code, source_type, department, test_group, sample_type, container_type, collected_at, received_at, status, priority, reject_reason, created_at, updated_at) VALUES
  (1, 'S202606120001', 'P-DEMO-0001', 'outpatient', '心内科', '生化组', '血清', '黄帽管', '2026-06-12 08:02:00', '2026-06-12 08:25:00', 'reviewing', 'stat', NULL, '2026-06-12 08:25:00', '2026-06-12 09:10:00'),
  (2, 'S202606120002', 'P-DEMO-0002', 'inpatient', '呼吸科', '免疫组', '血清', '黄帽管', '2026-06-12 08:12:00', '2026-06-12 08:36:00', 'critical_pending', 'urgent', NULL, '2026-06-12 08:36:00', '2026-06-12 09:20:00'),
  (3, 'S202606120003', 'P-DEMO-0003', 'emergency', '急诊科', '血常规组', '全血', '紫帽管', '2026-06-12 08:18:00', '2026-06-12 08:30:00', 'released', 'stat', NULL, '2026-06-12 08:30:00', '2026-06-12 09:25:00'),
  (4, 'S202606120004', 'P-DEMO-0004', 'outpatient', '消化科', '免疫组', '血清', '黄帽管', '2026-06-12 08:45:00', NULL, 'rejected', 'routine', '样本量不足，建议重新采集。', '2026-06-12 09:00:00', '2026-06-12 09:00:00'),
  (5, 'S202606120005', 'P-DEMO-0005', 'outpatient', '内分泌科', '生化组', '血清', '黄帽管', '2026-06-12 09:05:00', NULL, 'pending_receive', 'routine', NULL, '2026-06-12 09:08:00', '2026-06-12 09:08:00');

INSERT INTO test_items (id, item_code, item_name, unit, reference_range, critical_low, critical_high, department_group, status, created_at, updated_at) VALUES
  (1, 'K', '钾', 'mmol/L', '3.5-5.5', '2.8', '6.2', '生化组', 'active', '2026-06-01 08:20:00', '2026-06-01 08:20:00'),
  (2, 'GLU', '葡萄糖', 'mmol/L', '3.9-6.1', '2.5', '25.0', '生化组', 'active', '2026-06-01 08:20:00', '2026-06-01 08:20:00'),
  (3, 'HBSAG', '乙肝表面抗原', 'S/CO', '<1.0', NULL, NULL, '免疫组', 'active', '2026-06-01 08:20:00', '2026-06-01 08:20:00'),
  (4, 'WBC', '白细胞计数', '10^9/L', '3.5-9.5', '1.0', '30.0', '血常规组', 'active', '2026-06-01 08:20:00', '2026-06-01 08:20:00');

INSERT INTO instruments (id, instrument_code, instrument_name, department_group, status, last_calibrated_at, last_qc_at, created_at, updated_at) VALUES
  (1, 'BIO-8000-01', '全自动生化分析仪 01', '生化组', 'online', '2026-06-11 07:30:00', '2026-06-12 07:50:00', '2026-06-01 08:30:00', '2026-06-12 07:50:00'),
  (2, 'IMM-6000-01', '全自动化学发光仪 01', '免疫组', 'online', '2026-06-10 16:30:00', '2026-06-12 07:45:00', '2026-06-01 08:30:00', '2026-06-12 07:45:00'),
  (3, 'CBC-900-01', '全自动血细胞分析仪 01', '血常规组', 'maintenance', '2026-06-09 18:00:00', '2026-06-12 08:10:00', '2026-06-01 08:30:00', '2026-06-12 08:10:00');

INSERT INTO test_results (id, sample_id, test_item_id, result_value, result_text, unit, reference_range, abnormal_flag, critical_flag, instrument_id, qc_status, result_status, reported_at, created_at, updated_at) VALUES
  (1, 1, 1, '6.8', NULL, 'mmol/L', '3.5-5.5', 'high', 'critical_high', 1, 'passed', 'pending_review', '2026-06-12 09:05:00', '2026-06-12 09:05:00', '2026-06-12 09:05:00'),
  (2, 1, 2, '5.7', NULL, 'mmol/L', '3.9-6.1', 'normal', 'none', 1, 'passed', 'auto_release_candidate', '2026-06-12 09:05:00', '2026-06-12 09:05:00', '2026-06-12 09:05:00'),
  (3, 2, 3, '18.6', '阳性', 'S/CO', '<1.0', 'positive', 'none', 2, 'passed', 'pending_review', '2026-06-12 09:12:00', '2026-06-12 09:12:00', '2026-06-12 09:12:00'),
  (4, 3, 4, '8.2', NULL, '10^9/L', '3.5-9.5', 'normal', 'none', 3, 'warning', 'released', '2026-06-12 09:15:00', '2026-06-12 09:15:00', '2026-06-12 09:25:00');

INSERT INTO ai_pre_reviews (id, sample_id, result_id, ai_level, risk_tags_json, hit_rules_json, conclusion, suggested_action, manual_override, created_at) VALUES
  (1, 1, 1, 'high_risk', '["危急值","高钾血症风险","需复核"]', '[{"rule":"K_CRITICAL_HIGH","threshold":">=6.2 mmol/L"}]', '钾结果超过危急上限，建议立即复核并进入危急值闭环。', '人工审核后通知临床医生。', 'no', '2026-06-12 09:06:00'),
  (2, 1, 2, 'low_risk', '["正常范围","可自动放行候选"]', '[{"rule":"NORMAL_RANGE","item":"GLU"}]', '葡萄糖结果在参考范围内，质控通过。', '可进入自动放行候选队列。', 'no', '2026-06-12 09:06:00'),
  (3, 2, 3, 'medium_risk', '["传染病阳性预警","需人工确认"]', '[{"rule":"INFECTIOUS_POSITIVE","item":"HBSAG","condition":"S/CO >= 1.0"}]', '乙肝表面抗原阳性，建议人工确认并提示院感上报流程。', '复核结果并同步传染病阳性预警。', 'no', '2026-06-12 09:13:00');

INSERT INTO result_reviews (id, sample_id, result_id, review_status, reviewer_id, review_opinion, review_action, reviewed_at, created_at) VALUES
  (1, 1, 1, 'pending', 2, '等待复测结果确认。', 'hold_and_repeat', NULL, '2026-06-12 09:08:00'),
  (2, 1, 2, 'approved', 2, '结果与历史趋势一致，允许放行。', 'release', '2026-06-12 09:18:00', '2026-06-12 09:18:00'),
  (3, 3, 4, 'approved', 2, '血常规结果正常，质控提示已核查。', 'release', '2026-06-12 09:25:00', '2026-06-12 09:25:00');

INSERT INTO critical_values (id, sample_id, result_id, item_name, result_value, unit, threshold_text, triggered_at, status, responsible_doctor, closed_at, created_at, updated_at) VALUES
  (1, 1, 1, '钾', '6.8', 'mmol/L', '高于危急上限 6.2 mmol/L', '2026-06-12 09:06:30', 'notified', '张医生（演示）', NULL, '2026-06-12 09:06:30', '2026-06-12 09:16:00');

INSERT INTO critical_notifications (id, critical_value_id, notify_method, notify_target, notified_by, notified_at, confirm_status, confirmed_at, remark, created_at) VALUES
  (1, 1, 'phone', '心内科护士站（演示号码）', 2, '2026-06-12 09:15:00', 'confirmed', '2026-06-12 09:16:00', '临床已确认知晓，等待复测回报。', '2026-06-12 09:15:00'),
  (2, 1, 'system_message', '心内科值班医生账号', 2, '2026-06-12 09:15:30', 'pending', NULL, '系统消息已发送。', '2026-06-12 09:15:30');

INSERT INTO qc_events (id, instrument_id, test_item_id, event_no, qc_level, trigger_rule, event_status, impact_scope, suggested_action, handled_by, handled_at, created_at, updated_at) VALUES
  (1, 3, 4, 'QC202606120001', 'level_2', 'Westgard 1-2s 警告', 'handling', '影响血常规组 08:00-09:00 的白细胞结果复核', '复查质控品并抽查同批次样本。', 4, NULL, '2026-06-12 08:40:00', '2026-06-12 09:10:00'),
  (2, 1, 1, 'QC202606120002', 'level_1', '日间质控通过', 'closed', '无影响', '继续检测。', 4, '2026-06-12 07:55:00', '2026-06-12 07:50:00', '2026-06-12 07:55:00');

INSERT INTO reagent_batches (id, reagent_name, batch_no, test_item_id, instrument_id, enabled_at, expires_at, stock_qty, status, created_at, updated_at) VALUES
  (1, '钾电极维护液', 'K-EL-202605', 1, 1, '2026-06-01 07:30:00', '2026-06-28', 3, 'active', '2026-06-01 07:30:00', '2026-06-12 09:00:00'),
  (2, '乙肝表面抗原试剂盒', 'HBSAG-202604', 3, 2, '2026-06-05 07:30:00', '2026-06-18', 2, 'active', '2026-06-05 07:30:00', '2026-06-12 09:00:00');

INSERT INTO reagent_expiry_alerts (id, reagent_batch_id, days_left, risk_level, suggested_action, alert_status, created_at, updated_at) VALUES
  (1, 1, 16, 'medium', '计划补货并优先使用当前批次。', 'open', '2026-06-12 09:00:00', '2026-06-12 09:00:00'),
  (2, 2, 6, 'high', '高优先级提醒：确认库存、安排替换批次并记录启用验证。', 'open', '2026-06-12 09:00:00', '2026-06-12 09:00:00');

INSERT INTO infectious_alerts (id, sample_id, result_id, disease_item, positive_condition, review_status, notify_status, infection_control_status, report_hint_status, deadline_at, created_at, updated_at) VALUES
  (1, 2, 3, '乙肝表面抗原', '结果 S/CO=18.6，判定阳性', 'pending_review', 'pending_notify', 'pending_followup', 'hint_generated', '2026-06-12 11:12:00', '2026-06-12 09:13:30', '2026-06-12 09:13:30');

INSERT INTO system_rules (id, rule_type, rule_name, rule_config_json, version_no, status, created_by, approved_by, created_at, updated_at) VALUES
  (1, 'critical_value', '钾危急值规则', '{"item_code":"K","low":"2.8","high":"6.2","unit":"mmol/L","notify_minutes":15}', 'v1.0', 'active', 1, 2, '2026-06-01 09:00:00', '2026-06-01 09:30:00'),
  (2, 'ai_pre_review', '正常结果自动放行候选规则', '{"qc_status":"passed","abnormal_flag":"normal","history_delta":"within_expected","exclude_priority":["stat"]}', 'v1.0', 'active', 1, 2, '2026-06-01 09:10:00', '2026-06-01 09:40:00'),
  (3, 'infectious_alert', '乙肝阳性预警规则', '{"item_code":"HBSAG","positive_condition":"S/CO >= 1.0","deadline_hours":2}', 'v1.0', 'active', 1, 2, '2026-06-01 09:20:00', '2026-06-01 09:50:00'),
  (4, 'reagent_expiry', '试剂近效期预警规则', '{"medium_days":30,"high_days":7,"notify_roles":["qc_manager","admin"]}', 'v1.0', 'active', 1, 4, '2026-06-01 09:30:00', '2026-06-01 10:00:00');

INSERT INTO audit_logs (id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark, created_at) VALUES
  (1, 3, '样本签收', 'receive_sample', 'samples', 1, NULL, '{"status":"reviewing","received_at":"2026-06-12 08:25:00"}', '签收演示样本 S202606120001。', '2026-06-12 08:25:10'),
  (2, 2, 'AI 预审', 'create_ai_pre_review', 'ai_pre_reviews', 1, NULL, '{"ai_level":"high_risk","suggested_action":"人工审核后通知临床医生。"}', 'AI 预审生成高风险提示。', '2026-06-12 09:06:05'),
  (3, 2, '危急值中心', 'notify_critical_value', 'critical_notifications', 1, '{"confirm_status":"pending"}', '{"confirm_status":"confirmed","confirmed_at":"2026-06-12 09:16:00"}', '危急值电话通知并记录确认。', '2026-06-12 09:16:05'),
  (4, 4, '质控看板', 'handle_qc_event', 'qc_events', 1, '{"event_status":"open"}', '{"event_status":"handling","handled_by":4}', '质控负责人开始处理 Westgard 警告。', '2026-06-12 09:10:10'),
  (5, 1, '系统设置', 'approve_rule', 'system_rules', 4, '{"status":"draft"}', '{"status":"active","approved_by":4}', '启用试剂近效期预警规则。', '2026-06-01 10:00:10');

-- Synthetic/capability-proof profiles only. No real clinical endpoint or patient data is used.
INSERT INTO interface_adapters (adapter_id, adapter_name, adapter_type, protocol, direction, enabled, connection_config_json, parser_name, formatter_name, health_status, retry_policy_json, capability_label, created_at, updated_at) VALUES
  ('his-local', 'HIS Local Simulator', 'external-system', 'HL7v2/HTTP', 'bidirectional', 1, '{"endpoint":"http://127.0.0.1:17771/hl7","mode":"simulator"}', 'hl7', 'hl7', 'online', '{"maxAttempts":3,"strategy":"exponential","delaySeconds":1}', 'simulator capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('emr-local', 'EMR Local Simulator', 'external-system', 'internal-mock', 'outbound', 1, '{"mode":"simulator"}', 'json', 'hl7', 'online', '{"maxAttempts":3,"strategy":"fixed","delaySeconds":1}', 'simulator capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('exam-local', 'Examination Local Simulator', 'external-system', 'file-drop', 'bidirectional', 1, '{"directory":"interface-drop/exam","mode":"simulator"}', 'json', 'json', 'online', '{"maxAttempts":3,"strategy":"fixed","delaySeconds":1}', 'simulator capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('billing-local', 'Billing Local Simulator', 'external-system', 'REST/HTTP', 'bidirectional', 1, '{"endpoint":"http://127.0.0.1:17771/billing","mode":"simulator"}', 'json', 'json', 'online', '{"maxAttempts":3,"strategy":"exponential","delaySeconds":1}', 'simulator capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('cbc-synthetic', 'Hematology Synthetic Instrument', 'instrument', 'ASTM/TCP', 'bidirectional', 1, '{"host":"127.0.0.1","port":17772,"mode":"synthetic-profile"}', 'astm', 'astm', 'online', '{"maxAttempts":4,"strategy":"fixed","delaySeconds":1}', 'synthetic profile capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('bio-synthetic', 'Chemistry Synthetic Instrument', 'instrument', 'HL7v2/internal-mock', 'bidirectional', 1, '{"mode":"synthetic-profile"}', 'hl7', 'hl7', 'online', '{"maxAttempts":4,"strategy":"fixed","delaySeconds":1}', 'synthetic profile capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('immuno-synthetic', 'Immunoassay Synthetic Instrument', 'instrument', 'file-drop', 'bidirectional', 1, '{"directory":"interface-drop/immuno","mode":"synthetic-profile"}', 'json', 'json', 'online', '{"maxAttempts":4,"strategy":"fixed","delaySeconds":1}', 'synthetic profile capability proof', '2026-06-12 08:00:00', '2026-06-12 08:00:00');

INSERT INTO interface_mappings (adapter_id, field_key, external_field, local_field, transform_json, enabled)
SELECT id, 'patient_id', 'PID.3', 'samples.external_patient_id', '{}', 1 FROM interface_adapters WHERE adapter_id = 'his-local'
UNION ALL SELECT id, 'order_no', 'ORC.2', 'laboratory_orders.external_order_no', '{}', 1 FROM interface_adapters WHERE adapter_id = 'his-local'
UNION ALL SELECT id, 'sample_barcode', 'OBR.3', 'samples.sample_no', '{}', 1 FROM interface_adapters WHERE adapter_id = 'his-local'
UNION ALL SELECT id, 'test_code', 'OBR.4.1', 'laboratory_order_items.local_item_code', '{"codeMap":{"POTASSIUM":"K","GLUCOSE":"GLU","WBC":"WBC","HBSAG":"HBSAG"}}', 1 FROM interface_adapters WHERE adapter_id = 'his-local'
UNION ALL SELECT id, 'result_value', 'OBX.5', 'test_results.result_value', '{}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'unit', 'OBX.6', 'test_results.unit', '{}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'reference_range', 'OBX.7', 'test_results.reference_range', '{}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'abnormal_flag', 'OBX.8', 'test_results.abnormal_flag', '{"codeMap":{"H":"high","L":"low","N":"normal"}}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'result_time', 'OBX.14', 'test_results.reported_at', '{}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'instrument_id', 'MSH.3', 'instruments.instrument_code', '{}', 1 FROM interface_adapters WHERE adapter_id = 'bio-synthetic'
UNION ALL SELECT id, 'external_status', 'ORC.5', 'samples.external_status_code', '{}', 1 FROM interface_adapters WHERE adapter_id = 'his-local';

INSERT INTO simulator_scenarios (simulator_id, simulator_type, transport, profile_json, fault_mode, connection_status, deterministic_rule, created_at, updated_at) VALUES
  ('his-simulator', 'HIS', 'HL7v2/HTTP', '{"capabilities":["create-order","receive-ack"]}', 'success', 'connected', 'order and sample numbers derive from scenario key', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('emr-simulator', 'EMR/EHR', 'internal-mock', '{"capabilities":["receive-report","return-ack"]}', 'success', 'connected', 'ACK outcome follows selected fault mode', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('exam-simulator', 'health-check', 'file-drop', '{"capabilities":["create-order","receive-result"]}', 'success', 'connected', 'order and ACK are deterministic', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('billing-simulator', 'billing', 'REST/HTTP', '{"capabilities":["receive-charge","success","reject","timeout"]}', 'success', 'connected', 'response follows selected fault mode', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('cbc-synthetic', 'hematology-instrument', 'ASTM/TCP', '{"items":["WBC"],"instrumentCode":"CBC-900-01"}', 'success', 'connected', 'WBC=7.1 normal, 18.4 abnormal, 35.2 critical by scenario', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('bio-synthetic', 'chemistry-instrument', 'HL7v2/internal-mock', '{"items":["K","GLU"],"instrumentCode":"BIO-8000-01"}', 'success', 'connected', 'K=4.2 normal, 5.9 abnormal, 6.8 critical by scenario', '2026-06-12 08:00:00', '2026-06-12 08:00:00'),
  ('immuno-synthetic', 'immunoassay-instrument', 'file-drop', '{"items":["HBSAG"],"instrumentCode":"IMM-6000-01"}', 'success', 'connected', 'HBsAg=0.2 normal, 1.4 abnormal, 18.6 critical demonstration by scenario', '2026-06-12 08:00:00', '2026-06-12 08:00:00');
