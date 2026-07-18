-- TERRY-LIS 数据库第一版结构设计
-- 目标：优先兼容 SQLite，后续可平滑迁移到 PostgreSQL。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role_id INTEGER NOT NULL,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_no TEXT NOT NULL UNIQUE,
  patient_code TEXT NOT NULL,
  source_type TEXT NOT NULL,
  department TEXT,
  test_group TEXT,
  sample_type TEXT,
  container_type TEXT,
  collected_at TEXT,
  received_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending_receive',
  priority TEXT NOT NULL DEFAULT 'routine',
  reject_reason TEXT,
  external_patient_id TEXT,
  external_order_no TEXT,
  external_status_code TEXT,
  interface_trace_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sample_recollection_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  sample_no TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS test_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  critical_low TEXT,
  critical_high TEXT,
  department_group TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_code TEXT NOT NULL UNIQUE,
  instrument_name TEXT NOT NULL,
  department_group TEXT,
  status TEXT NOT NULL DEFAULT 'online',
  last_calibrated_at TEXT,
  last_qc_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  test_item_id INTEGER NOT NULL,
  result_value TEXT,
  result_text TEXT,
  unit TEXT,
  reference_range TEXT,
  abnormal_flag TEXT NOT NULL DEFAULT 'normal',
  critical_flag TEXT NOT NULL DEFAULT 'none',
  instrument_id INTEGER,
  qc_status TEXT NOT NULL DEFAULT 'passed',
  result_status TEXT NOT NULL DEFAULT 'pending_review',
  reported_at TEXT,
  interface_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (test_item_id) REFERENCES test_items(id),
  FOREIGN KEY (instrument_id) REFERENCES instruments(id)
);

CREATE TABLE IF NOT EXISTS ai_pre_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  ai_level TEXT NOT NULL,
  risk_tags_json TEXT NOT NULL DEFAULT '[]',
  hit_rules_json TEXT NOT NULL DEFAULT '[]',
  conclusion TEXT,
  suggested_action TEXT,
  manual_override TEXT NOT NULL DEFAULT 'no',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (result_id) REFERENCES test_results(id)
);

CREATE TABLE IF NOT EXISTS result_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  review_status TEXT NOT NULL,
  reviewer_id INTEGER,
  review_opinion TEXT,
  review_action TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (result_id) REFERENCES test_results(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS critical_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  unit TEXT,
  threshold_text TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  responsible_doctor TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (result_id) REFERENCES test_results(id)
);

CREATE TABLE IF NOT EXISTS critical_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  critical_value_id INTEGER NOT NULL,
  notify_method TEXT NOT NULL,
  notify_target TEXT NOT NULL,
  notified_by INTEGER,
  notified_at TEXT,
  confirm_status TEXT NOT NULL DEFAULT 'pending',
  confirmed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (critical_value_id) REFERENCES critical_values(id),
  FOREIGN KEY (notified_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS qc_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id INTEGER NOT NULL,
  test_item_id INTEGER,
  event_no TEXT NOT NULL UNIQUE,
  qc_level TEXT,
  trigger_rule TEXT,
  event_status TEXT NOT NULL DEFAULT 'open',
  impact_scope TEXT,
  suggested_action TEXT,
  handled_by INTEGER,
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instrument_id) REFERENCES instruments(id),
  FOREIGN KEY (test_item_id) REFERENCES test_items(id),
  FOREIGN KEY (handled_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reagent_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reagent_name TEXT NOT NULL,
  batch_no TEXT NOT NULL,
  test_item_id INTEGER,
  instrument_id INTEGER,
  enabled_at TEXT,
  expires_at TEXT NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reagent_name, batch_no),
  FOREIGN KEY (test_item_id) REFERENCES test_items(id),
  FOREIGN KEY (instrument_id) REFERENCES instruments(id)
);

CREATE TABLE IF NOT EXISTS reagent_expiry_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reagent_batch_id INTEGER NOT NULL,
  days_left INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  suggested_action TEXT,
  alert_status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reagent_batch_id) REFERENCES reagent_batches(id)
);

CREATE TABLE IF NOT EXISTS infectious_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  disease_item TEXT NOT NULL,
  positive_condition TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  notify_status TEXT NOT NULL DEFAULT 'pending_notify',
  infection_control_status TEXT NOT NULL DEFAULT 'pending_followup',
  report_hint_status TEXT NOT NULL DEFAULT 'pending_hint',
  deadline_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (result_id) REFERENCES test_results(id)
);

CREATE TABLE IF NOT EXISTS system_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_config_json TEXT NOT NULL DEFAULT '{}',
  version_no TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  approved_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  module_name TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  target_table TEXT,
  target_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Interface & Reliable Communication Core (local capability proof only).
CREATE TABLE IF NOT EXISTS laboratory_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_order_no TEXT NOT NULL UNIQUE,
  patient_code TEXT NOT NULL,
  source_system TEXT NOT NULL,
  sample_id INTEGER,
  order_status TEXT NOT NULL DEFAULT 'received',
  priority TEXT NOT NULL DEFAULT 'routine',
  trace_id TEXT NOT NULL,
  ordered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sample_id) REFERENCES samples(id)
);

CREATE TABLE IF NOT EXISTS laboratory_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  external_item_code TEXT NOT NULL,
  local_item_code TEXT NOT NULL,
  instrument_item_code TEXT,
  status TEXT NOT NULL DEFAULT 'ordered',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, local_item_code),
  FOREIGN KEY (order_id) REFERENCES laboratory_orders(id)
);

CREATE TABLE IF NOT EXISTS interface_adapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter_id TEXT NOT NULL UNIQUE,
  adapter_name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  protocol TEXT NOT NULL,
  direction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  connection_config_json TEXT NOT NULL DEFAULT '{}',
  parser_name TEXT NOT NULL,
  formatter_name TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  last_communication_at TEXT,
  retry_policy_json TEXT NOT NULL DEFAULT '{"maxAttempts":3,"strategy":"fixed","delaySeconds":1}',
  capability_label TEXT NOT NULL DEFAULT 'capability proof',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interface_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  external_field TEXT NOT NULL,
  local_field TEXT NOT NULL,
  transform_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (adapter_id, field_key),
  FOREIGN KEY (adapter_id) REFERENCES interface_adapters(id)
);

CREATE TABLE IF NOT EXISTS interface_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  protocol TEXT NOT NULL,
  message_type TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  normalized_payload_json TEXT,
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_strategy TEXT NOT NULL DEFAULT 'fixed',
  retry_delay_seconds INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  next_retry_at TEXT,
  related_sample_id INTEGER,
  related_order_id INTEGER,
  related_report_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (related_sample_id) REFERENCES samples(id),
  FOREIGN KEY (related_order_id) REFERENCES laboratory_orders(id),
  FOREIGN KEY (related_report_id) REFERENCES test_results(id)
);

CREATE TABLE IF NOT EXISTS interface_message_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  response_payload TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (message_id) REFERENCES interface_messages(id)
);

CREATE TABLE IF NOT EXISTS interface_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  local_endpoint TEXT,
  connected_at TEXT,
  disconnected_at TEXT,
  last_heartbeat_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (adapter_id) REFERENCES interface_adapters(id)
);

CREATE TABLE IF NOT EXISTS simulator_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  simulator_id TEXT NOT NULL UNIQUE,
  simulator_type TEXT NOT NULL,
  transport TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  fault_mode TEXT NOT NULL DEFAULT 'success',
  connection_status TEXT NOT NULL DEFAULT 'connected',
  deterministic_rule TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_report_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL,
  destination_adapter_id INTEGER NOT NULL,
  message_id INTEGER,
  trace_id TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  ack_code TEXT,
  ack_payload TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (result_id, destination_adapter_id, trace_id),
  FOREIGN KEY (result_id) REFERENCES test_results(id),
  FOREIGN KEY (destination_adapter_id) REFERENCES interface_adapters(id),
  FOREIGN KEY (message_id) REFERENCES interface_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_samples_status_priority ON samples(status, priority);
CREATE INDEX IF NOT EXISTS idx_samples_received_at ON samples(received_at);
CREATE INDEX IF NOT EXISTS idx_sample_recollection_tasks_sample_id ON sample_recollection_tasks(sample_id);
CREATE INDEX IF NOT EXISTS idx_results_sample_id ON test_results(sample_id);
CREATE INDEX IF NOT EXISTS idx_results_item_status ON test_results(test_item_id, result_status);
CREATE INDEX IF NOT EXISTS idx_ai_pre_reviews_sample_id ON ai_pre_reviews(sample_id);
CREATE INDEX IF NOT EXISTS idx_result_reviews_result_id ON result_reviews(result_id);
CREATE INDEX IF NOT EXISTS idx_critical_values_status ON critical_values(status, triggered_at);
CREATE INDEX IF NOT EXISTS idx_qc_events_status ON qc_events(event_status, instrument_id);
CREATE INDEX IF NOT EXISTS idx_reagent_expiry_alerts_status ON reagent_expiry_alerts(alert_status, risk_level);
CREATE INDEX IF NOT EXISTS idx_infectious_alerts_status ON infectious_alerts(review_status, notify_status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_laboratory_orders_trace ON laboratory_orders(trace_id, order_status);
CREATE INDEX IF NOT EXISTS idx_interface_adapters_health ON interface_adapters(enabled, health_status);
CREATE INDEX IF NOT EXISTS idx_interface_mappings_adapter ON interface_mappings(adapter_id, enabled);
CREATE INDEX IF NOT EXISTS idx_interface_messages_queue ON interface_messages(status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_interface_messages_trace ON interface_messages(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interface_messages_related ON interface_messages(related_sample_id, related_order_id, related_report_id);
CREATE INDEX IF NOT EXISTS idx_interface_attempts_message ON interface_message_attempts(message_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_interface_connections_adapter ON interface_connections(adapter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_external_deliveries_result ON external_report_deliveries(result_id, delivery_status);
