-- TERRY-LIS local SQLite schema for the demo database.
-- This schema is intentionally local-only and contains mock/demo data only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY,
  sample_no TEXT NOT NULL UNIQUE,
  patient_alias TEXT NOT NULL,
  department TEXT NOT NULL,
  specimen_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  collected_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_items (
  id INTEGER PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  critical_low TEXT,
  critical_high TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY,
  sample_id INTEGER NOT NULL,
  test_item_id INTEGER NOT NULL,
  result_value TEXT NOT NULL,
  result_unit TEXT,
  result_flag TEXT NOT NULL DEFAULT 'normal',
  result_status TEXT NOT NULL DEFAULT 'pending_review',
  measured_at TEXT NOT NULL,
  FOREIGN KEY (sample_id) REFERENCES samples(id),
  FOREIGN KEY (test_item_id) REFERENCES test_items(id)
);

CREATE TABLE IF NOT EXISTS ai_pre_reviews (
  id INTEGER PRIMARY KEY,
  sample_id INTEGER NOT NULL,
  classification TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  matched_rules TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sample_id) REFERENCES samples(id)
);

CREATE TABLE IF NOT EXISTS result_reviews (
  id INTEGER PRIMARY KEY,
  test_result_id INTEGER NOT NULL,
  reviewer_user_id INTEGER,
  review_status TEXT NOT NULL,
  review_opinion TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (test_result_id) REFERENCES test_results(id),
  FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS critical_values (
  id INTEGER PRIMARY KEY,
  test_result_id INTEGER NOT NULL,
  critical_level TEXT NOT NULL,
  status TEXT NOT NULL,
  confirmed_by_user_id INTEGER,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (test_result_id) REFERENCES test_results(id),
  FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS critical_notifications (
  id INTEGER PRIMARY KEY,
  critical_value_id INTEGER NOT NULL,
  notify_target TEXT NOT NULL,
  notify_method TEXT NOT NULL,
  notify_status TEXT NOT NULL,
  notified_at TEXT,
  acknowledged_at TEXT,
  notes TEXT,
  FOREIGN KEY (critical_value_id) REFERENCES critical_values(id)
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY,
  instrument_code TEXT NOT NULL UNIQUE,
  instrument_name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  last_qc_at TEXT,
  next_calibration_at TEXT
);

CREATE TABLE IF NOT EXISTS qc_events (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_level TEXT NOT NULL,
  status TEXT NOT NULL,
  event_time TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (instrument_id) REFERENCES instruments(id)
);

CREATE TABLE IF NOT EXISTS reagent_batches (
  id INTEGER PRIMARY KEY,
  batch_no TEXT NOT NULL UNIQUE,
  reagent_name TEXT NOT NULL,
  instrument_id INTEGER,
  opened_at TEXT,
  expires_at TEXT NOT NULL,
  remaining_percent INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL,
  FOREIGN KEY (instrument_id) REFERENCES instruments(id)
);

CREATE TABLE IF NOT EXISTS reagent_expiry_alerts (
  id INTEGER PRIMARY KEY,
  reagent_batch_id INTEGER NOT NULL,
  alert_level TEXT NOT NULL,
  alert_message TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reagent_batch_id) REFERENCES reagent_batches(id)
);

CREATE TABLE IF NOT EXISTS infectious_alerts (
  id INTEGER PRIMARY KEY,
  sample_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  alert_level TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sample_id) REFERENCES samples(id)
);

CREATE TABLE IF NOT EXISTS system_rules (
  id INTEGER PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
