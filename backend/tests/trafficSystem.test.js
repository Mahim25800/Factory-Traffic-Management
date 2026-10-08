const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const db = require('../database/db');
const trafficEngine = require('../domain/trafficEngine');
const queueManager = require('../domain/queueManager');
const emergencyManager = require('../domain/emergencyManager');
const manualController = require('../domain/manualController');
const controllerAdapter = require('../domain/controllerAdapter');

const TEST_DB_PATH = path.join(__dirname, 'test_traffic.db');

describe('Factory Traffic Management - Core Safety & Functional Tests', () => {

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
    db.initDb(TEST_DB_PATH);
    controllerAdapter.setAutoAcknowledge(true);
  });

  afterEach(() => {
    trafficEngine.stopJunctionEngine('A');
    controllerAdapter.clearAllTimeouts();
    manualController.clearAllTimeouts();
    db.closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  test('Rule 1: Safety Invariant - Conflicting phases must NEVER receive GREEN simultaneously', () => {
    const safeNS = { NORTH: 'GREEN', SOUTH: 'GREEN', EAST: 'RED', WEST: 'RED' };
    assert.strictEqual(trafficEngine.isSafeSignalState(safeNS), true);

    const safeEW = { NORTH: 'RED', SOUTH: 'RED', EAST: 'GREEN', WEST: 'GREEN' };
    assert.strictEqual(trafficEngine.isSafeSignalState(safeEW), true);

    const safeAllRed = { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' };
    assert.strictEqual(trafficEngine.isSafeSignalState(safeAllRed), true);

    const unsafeState1 = { NORTH: 'GREEN', SOUTH: 'RED', EAST: 'GREEN', WEST: 'RED' };
    assert.strictEqual(trafficEngine.isSafeSignalState(unsafeState1), false);

    const unsafeState2 = { NORTH: 'GREEN', SOUTH: 'GREEN', EAST: 'GREEN', WEST: 'GREEN' };
    assert.strictEqual(trafficEngine.isSafeSignalState(unsafeState2), false);
  });

  test('Rule 2: Duplicate Sensor Event Idempotency - Same event_id does NOT double increment queue', () => {
    const event = {
      event_id: 'evt-test-101',
      junction_id: 'A',
      direction: 'NORTH',
      event_type: 'VEHICLE_ARRIVED',
      vehicle_id: 'VH-100',
      vehicle_type: 'TRUCK',
      sequence_no: 1,
      timestamp: new Date().toISOString()
    };

    const res1 = queueManager.processSensorEvent(event);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(res1.queues.NORTH, 1);

    const res2 = queueManager.processSensorEvent(event);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.duplicate, true);
    assert.strictEqual(res2.queues.NORTH, 1);
  });

  test('Rule 3: Vehicle Clearance - Decrements queue and never falls below 0', () => {
    queueManager.processSensorEvent({
      event_id: 'evt-test-arr-1',
      junction_id: 'A',
      direction: 'EAST',
      event_type: 'VEHICLE_ARRIVED',
      vehicle_id: 'VH-201',
      vehicle_type: 'FORKLIFT',
      sequence_no: 10,
      timestamp: new Date().toISOString()
    });

    let queues = db.getQueueCounts('A');
    assert.strictEqual(queues.EAST, 1);

    const clearRes = queueManager.processSensorEvent({
      event_id: 'evt-test-clr-1',
      junction_id: 'A',
      direction: 'EAST',
      event_type: 'VEHICLE_CLEARED',
      vehicle_id: 'VH-201',
      sequence_no: 11,
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(clearRes.success, true);
    assert.strictEqual(clearRes.queues.EAST, 0);

    // Excess clearance when queue is 0 must clamp to 0 and never fall below 0
    const extraClearRes = queueManager.processSensorEvent({
      event_id: 'evt-test-clr-2',
      junction_id: 'A',
      direction: 'EAST',
      event_type: 'VEHICLE_CLEARED',
      vehicle_id: 'VH-999',
      sequence_no: 12,
      timestamp: new Date().toISOString()
    });
    assert.strictEqual(extraClearRes.success, true);
    assert.strictEqual(extraClearRes.queues.EAST, 0);
  });

  test('Rule 4: Priority Scheduling Scoring - TRUCK and FORKLIFT outscore EMPLOYEE_VEHICLE', () => {
    queueManager.processSensorEvent({
      event_id: 'evt-emp-1',
      junction_id: 'A',
      direction: 'NORTH',
      event_type: 'VEHICLE_ARRIVED',
      vehicle_id: 'EMP-1',
      vehicle_type: 'EMPLOYEE_VEHICLE',
      timestamp: new Date().toISOString()
    });

    queueManager.processSensorEvent({
      event_id: 'evt-trk-1',
      junction_id: 'A',
      direction: 'EAST',
      event_type: 'VEHICLE_ARRIVED',
      vehicle_id: 'TRK-1',
      vehicle_type: 'TRUCK',
      timestamp: new Date().toISOString()
    });

    const scores = queueManager.calculatePhaseScores('A');
    // TRUCK weight (15) outranks employee vehicle (5)
    assert.ok(scores.EAST_WEST > scores.NORTH_SOUTH);
  });

  test('Rule 5: Emergency Vehicle Handling - Sets EMERGENCY mode and prioritizes phase', () => {
    const res = emergencyManager.handleEmergencyVehicle('A', 'WEST', 'EV-999');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetPhase, 'EAST_WEST');

    const junction = db.getJunction('A');
    assert.strictEqual(junction.mode, config.MODES.EMERGENCY);

    const clearRes = emergencyManager.handleEmergencyCleared('A', 'EV-999');
    assert.strictEqual(clearRes.success, true);
    assert.strictEqual(clearRes.mode, config.MODES.AUTOMATIC);
  });

  test('Rule 6: Manual Control - Sets MANUAL mode, respects directions, and allows return to AUTOMATIC', () => {
    const res = manualController.requestManualGreen('A', 'WEST');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.targetPhase, 'EAST_WEST');

    let junction = db.getJunction('A');
    assert.strictEqual(junction.mode, config.MODES.MANUAL);

    const retRes = manualController.returnToAutomatic('A');
    assert.strictEqual(retRes.success, true);
    assert.strictEqual(retRes.mode, config.MODES.AUTOMATIC);

    junction = db.getJunction('A');
    assert.strictEqual(junction.mode, config.MODES.AUTOMATIC);
  });

  test('Rule 7: Controller Failure & Acknowledgement - Updates actual state and detects offline', () => {
    const ackRes = controllerAdapter.handleControllerAcknowledgement({
      command_id: 'cmd-manual-1',
      junction_id: 'A',
      status: 'ACK',
      actual_state: { NORTH: 'RED', SOUTH: 'RED', EAST: 'GREEN', WEST: 'GREEN' }
    });
    assert.strictEqual(ackRes.success, true);

    let junction = db.getJunction('A');
    assert.strictEqual(junction.actual_signals.EAST, 'GREEN');
    assert.strictEqual(junction.controller_status, 'ONLINE');

    controllerAdapter.handleControllerAcknowledgement({
      device_type: 'SIGNAL_CONTROLLER',
      junction_id: 'A',
      status: 'OFFLINE'
    });

    junction = db.getJunction('A');
    assert.strictEqual(junction.controller_status, 'OFFLINE');
    assert.strictEqual(junction.mode, 'FAILURE');
  });

  test('Rule 8: Audit Logging - System operations are persisted in audit log', () => {
    db.addAuditLog('A', 'TEST_ACTION', 'Unit test audit log message', { key: 'value' });
    const history = db.getAuditHistory('A', 10);
    assert.ok(history.length > 0);
    const testLog = history.find(h => h.event_type === 'TEST_ACTION');
    assert.ok(testLog);
    assert.strictEqual(testLog.description, 'Unit test audit log message');
  });
});
