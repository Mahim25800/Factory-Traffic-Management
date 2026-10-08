CREATE TABLE IF NOT EXISTS junctions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'AUTOMATIC',
  current_phase TEXT NOT NULL DEFAULT 'NORTH_SOUTH',
  controller_status TEXT NOT NULL DEFAULT 'ONLINE',
  desired_signals TEXT NOT NULL,
  actual_signals TEXT NOT NULL,
  last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  junction_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  sequence_no INTEGER DEFAULT 0,
  arrived_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING'
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  junction_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  sequence_no INTEGER DEFAULT 0,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY,
  junction_id TEXT NOT NULL,
  direction TEXT,
  requested_state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  junction_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  details TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_queue_junction ON vehicle_queue(junction_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_junction ON audit_log(junction_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_commands_junction ON commands(junction_id, status);
