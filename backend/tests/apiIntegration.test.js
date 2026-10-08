const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const app = require('../server');
const trafficEngine = require('../domain/trafficEngine');
const controllerAdapter = require('../domain/controllerAdapter');
const manualController = require('../domain/manualController');

let server;
let baseUrl;

describe('API Integration Endpoints', () => {
  before(async () => {
    controllerAdapter.setAutoAcknowledge(true);
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    trafficEngine.stopJunctionEngine('A');
    controllerAdapter.clearAllTimeouts();
    manualController.clearAllTimeouts();
    try {
      const db = require('../database/db');
      const d = db.initDb();
      d.prepare("DELETE FROM vehicle_queue WHERE vehicle_id = 'VH-INT-1'").run();
      d.prepare("DELETE FROM processed_events WHERE event_id LIKE 'evt-integ-%'").run();
    } catch (e) {}
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /api/junctions/A/status returns current junction status', async () => {
    const res = await fetch(`${baseUrl}/api/junctions/A/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.junction_id, 'A');
    assert.ok(data.desired_signals);
    assert.ok(data.actual_signals);
    assert.ok(data.queues);
  });

  test('POST /api/sensor-events records vehicle arrival and deduplicates', async () => {
    const eventId = `evt-integ-${Date.now()}`;
    const payload = {
      event_id: eventId,
      junction_id: 'A',
      direction: 'NORTH',
      event_type: 'VEHICLE_ARRIVED',
      vehicle_id: 'VH-INT-1',
      vehicle_type: 'FORKLIFT',
      sequence_no: 50,
      timestamp: new Date().toISOString()
    };

    const res1 = await fetch(`${baseUrl}/api/sensor-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res1.status, 200);
    const data1 = await res1.json();
    assert.strictEqual(data1.success, true);
    assert.strictEqual(data1.duplicate, false);

    const res2 = await fetch(`${baseUrl}/api/sensor-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.duplicate, true);
  });

  test('POST /api/junctions/A/commands processes manual override', async () => {
    const res = await fetch(`${baseUrl}/api/junctions/A/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'MANUAL_GREEN_REQUEST',
        direction: 'EAST'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.targetPhase, 'EAST_WEST');
  });

  test('GET /api/junctions/A/history returns audit log list', async () => {
    const res = await fetch(`${baseUrl}/api/junctions/A/history?limit=10`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.history));
    assert.ok(data.history.length > 0);
  });
});
