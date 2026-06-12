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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_samples_status_priority ON samples(status, priority);
CREATE INDEX IF NOT EXISTS idx_samples_received_at ON samples(received_at);
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
