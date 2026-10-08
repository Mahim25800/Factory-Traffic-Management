const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

let db = null;

function initDb(dbPath) {
  const finalPath = dbPath || path.join(__dirname, 'traffic.db');
  db = new DatabaseSync(finalPath);

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schemaSql);

  // Seed default Junction A if starting from empty database
  const existingA = getJunction('A');
  if (!existingA) {
    const now = new Date().toISOString();
    const initialSignals = JSON.stringify({
      NORTH: 'GREEN',
      SOUTH: 'GREEN',
      EAST: 'RED',
      WEST: 'RED'
    });

    const stmt = db.prepare(`
      INSERT INTO junctions (id, name, mode, current_phase, controller_status, desired_signals, actual_signals, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run('A', 'Junction A - Main Assembly Road', 'AUTOMATIC', 'NORTH_SOUTH', 'ONLINE', initialSignals, initialSignals, now);

    addAuditLog('A', 'SYSTEM_INITIALIZED', 'Junction A initialized with default NORTH_SOUTH phase', {
      initialSignals: JSON.parse(initialSignals)
    });
  }

  return db;
}

function getJunction(id) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM junctions WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;

  return {
    ...row,
    desired_signals: JSON.parse(row.desired_signals),
    actual_signals: JSON.parse(row.actual_signals)
  };
}

function listJunctions() {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM junctions ORDER BY id ASC');
  const rows = stmt.all();
  return rows.map(row => ({
    ...row,
    desired_signals: JSON.parse(row.desired_signals),
    actual_signals: JSON.parse(row.actual_signals)
  }));
}

function createJunction(id, name) {
  const now = new Date().toISOString();
  const initialSignals = JSON.stringify({
    NORTH: 'GREEN',
    SOUTH: 'GREEN',
    EAST: 'RED',
    WEST: 'RED'
  });

  const stmt = db.prepare(`
    INSERT INTO junctions (id, name, mode, current_phase, controller_status, desired_signals, actual_signals, last_updated)
    VALUES (?, ?, 'AUTOMATIC', 'NORTH_SOUTH', 'ONLINE', ?, ?, ?)
  `);
  stmt.run(id, name, initialSignals, initialSignals, now);
  addAuditLog(id, 'JUNCTION_CREATED', `Junction ${id} created`, { name });
  return getJunction(id);
}

function updateJunction(id, updates) {
  const current = getJunction(id);
  if (!current) return null;

  const mode = updates.mode !== undefined ? updates.mode : current.mode;
  const phase = updates.current_phase !== undefined ? updates.current_phase : current.current_phase;
  const status = updates.controller_status !== undefined ? updates.controller_status : current.controller_status;
  const desired = updates.desired_signals !== undefined ? JSON.stringify(updates.desired_signals) : JSON.stringify(current.desired_signals);
  const actual = updates.actual_signals !== undefined ? JSON.stringify(updates.actual_signals) : JSON.stringify(current.actual_signals);
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE junctions
    SET mode = ?, current_phase = ?, controller_status = ?, desired_signals = ?, actual_signals = ?, last_updated = ?
    WHERE id = ?
  `);
  stmt.run(mode, phase, status, desired, actual, now, id);

  return getJunction(id);
}

function addVehicle(junctionId, vehicleId, vehicleType, direction, sequenceNo) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO vehicle_queue (junction_id, vehicle_id, vehicle_type, direction, sequence_no, arrived_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'WAITING')
  `);
  stmt.run(junctionId, vehicleId, vehicleType, direction, sequenceNo || 0, now);
}

function clearVehicle(junctionId, direction, vehicleId) {
  if (vehicleId) {
    const stmt = db.prepare(`
      UPDATE vehicle_queue
      SET status = 'CLEARED'
      WHERE id = (
        SELECT id FROM vehicle_queue
        WHERE junction_id = ? AND vehicle_id = ? AND direction = ? AND status = 'WAITING'
        ORDER BY id ASC
        LIMIT 1
      )
    `);
    const result = stmt.run(junctionId, vehicleId, direction);
    if (result.changes > 0) return true;
  }

  // Fallback: clear oldest waiting vehicle in that direction if vehicleId was not specified or matched
  const fallbackStmt = db.prepare(`
    UPDATE vehicle_queue
    SET status = 'CLEARED'
    WHERE id = (
      SELECT id FROM vehicle_queue
      WHERE junction_id = ? AND direction = ? AND status = 'WAITING'
      ORDER BY id ASC
      LIMIT 1
    )
  `);
  const fallbackResult = fallbackStmt.run(junctionId, direction);
  return fallbackResult.changes > 0;
}

function getWaitingVehicles(junctionId) {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT * FROM vehicle_queue
    WHERE junction_id = ? AND status = 'WAITING'
    ORDER BY id ASC
  `);
  return stmt.all(junctionId);
}

function getQueueCounts(junctionId) {
  const counts = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
  if (!db) return counts;

  const stmt = db.prepare(`
    SELECT direction, COUNT(*) as count
    FROM vehicle_queue
    WHERE junction_id = ? AND status = 'WAITING'
    GROUP BY direction
  `);
  const rows = stmt.all(junctionId);
  for (const row of rows) {
    if (counts[row.direction] !== undefined) {
      counts[row.direction] = Number(row.count);
    }
  }
  return counts;
}

function isEventProcessed(eventId) {
  if (!db || !eventId) return false;
  const stmt = db.prepare('SELECT event_id FROM processed_events WHERE event_id = ?');
  const row = stmt.get(eventId);
  return !!row;
}

function markEventProcessed(eventId, junctionId, eventType, sequenceNo) {
  if (!db || !eventId) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO processed_events (event_id, junction_id, event_type, sequence_no, received_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(eventId, junctionId, eventType, sequenceNo || 0, now);
}

function saveCommand(commandId, junctionId, direction, requestedState) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO commands (command_id, junction_id, direction, requested_state, status, created_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?)
  `);
  stmt.run(commandId, junctionId, direction || null, requestedState, now);
}

function updateCommandStatus(commandId, status) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE commands
    SET status = ?, acknowledged_at = ?
    WHERE command_id = ?
  `);
  return stmt.run(status, now, commandId);
}

function getCommand(commandId) {
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM commands WHERE command_id = ?');
  return stmt.get(commandId);
}

function addAuditLog(junctionId, eventType, description, details) {
  if (!db) return;
  const now = new Date().toISOString();
  const detailsStr = details ? JSON.stringify(details) : null;
  const stmt = db.prepare(`
    INSERT INTO audit_log (junction_id, event_type, description, details, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(junctionId, eventType, description, detailsStr, now);
}

function getAuditHistory(junctionId, limit = 50) {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT * FROM audit_log
    WHERE junction_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  const rows = stmt.all(junctionId, limit);
  return rows.map(row => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null
  }));
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDb,
  getJunction,
  listJunctions,
  createJunction,
  updateJunction,
  addVehicle,
  clearVehicle,
  getWaitingVehicles,
  getQueueCounts,
  isEventProcessed,
  markEventProcessed,
  saveCommand,
  updateCommandStatus,
  getCommand,
  addAuditLog,
  getAuditHistory,
  closeDb
};
