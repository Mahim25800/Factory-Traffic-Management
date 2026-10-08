const db = require('../database/db');
const config = require('../config');

function validateSensorEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'Event payload must be a JSON object' };
  }

  if (!event.event_id || typeof event.event_id !== 'string') {
    return { valid: false, error: 'Missing or invalid event_id' };
  }

  if (!event.junction_id || typeof event.junction_id !== 'string') {
    return { valid: false, error: 'Missing or invalid junction_id' };
  }

  if (!config.DIRECTIONS.includes(event.direction)) {
    return { valid: false, error: `Invalid direction: ${event.direction}. Must be one of ${config.DIRECTIONS.join(', ')}` };
  }

  if (!['VEHICLE_ARRIVED', 'VEHICLE_CLEARED'].includes(event.event_type)) {
    return { valid: false, error: `Invalid event_type: ${event.event_type}. Must be VEHICLE_ARRIVED or VEHICLE_CLEARED` };
  }

  if (event.event_type === 'VEHICLE_ARRIVED') {
    if (!event.vehicle_type || !config.VEHICLE_PRIORITIES[event.vehicle_type]) {
      return { valid: false, error: `Invalid vehicle_type: ${event.vehicle_type}. Must be one of ${Object.keys(config.VEHICLE_PRIORITIES).join(', ')}` };
    }
  }

  return { valid: true };
}

function processSensorEvent(event) {
  const validation = validateSensorEvent(event);
  if (!validation.valid) {
    return { success: false, status: 400, error: validation.error };
  }

  // Idempotency: Reject repeated submissions with duplicate event_id
  // TODO (Incomplete - 4-5h Limit): Out-of-order packet resequencing buffer based on sequence_no
  // was deferred due to assessment time limit. Idempotency is enforced strictly via unique event_id.
  if (db.isEventProcessed(event.event_id)) {
    db.addAuditLog(
      event.junction_id,
      'DUPLICATE_EVENT_REJECTED',
      `Duplicate event ${event.event_id} ignored`,
      { event_id: event.event_id, event_type: event.event_type }
    );
    return {
      success: true,
      duplicate: true,
      message: 'Duplicate event ignored, state unmodified',
      queues: db.getQueueCounts(event.junction_id)
    };
  }

  if (event.event_type === 'VEHICLE_ARRIVED') {
    db.addVehicle(
      event.junction_id,
      event.vehicle_id || `VH-${Date.now()}`,
      event.vehicle_type,
      event.direction,
      event.sequence_no || 0
    );

    db.markEventProcessed(event.event_id, event.junction_id, event.event_type, event.sequence_no);

    db.addAuditLog(
      event.junction_id,
      'VEHICLE_ARRIVED',
      `${event.vehicle_type} (${event.vehicle_id}) arrived at ${event.direction}`,
      { vehicle_id: event.vehicle_id, vehicle_type: event.vehicle_type, direction: event.direction }
    );

    return {
      success: true,
      duplicate: false,
      message: 'Vehicle arrived and queued',
      queues: db.getQueueCounts(event.junction_id)
    };
  }

  if (event.event_type === 'VEHICLE_CLEARED') {
    const cleared = db.clearVehicle(event.junction_id, event.direction, event.vehicle_id);

    db.markEventProcessed(event.event_id, event.junction_id, event.event_type, event.sequence_no);

    db.addAuditLog(
      event.junction_id,
      'VEHICLE_CLEARED',
      `Vehicle cleared from ${event.direction}`,
      { vehicle_id: event.vehicle_id, direction: event.direction, foundInQueue: cleared }
    );

    return {
      success: true,
      duplicate: false,
      message: cleared ? 'Vehicle cleared from queue' : 'Vehicle cleared (queue was empty or vehicle not matched)',
      queues: db.getQueueCounts(event.junction_id)
    };
  }
}

function calculatePhaseScores(junctionId) {
  const waitingVehicles = db.getWaitingVehicles(junctionId);
  const now = Date.now();

  const directionScores = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
  const emergencyCount = { NORTH_SOUTH: 0, EAST_WEST: 0 };

  for (const v of waitingVehicles) {
    const priorityWeight = config.VEHICLE_PRIORITIES[v.vehicle_type] || 5;

    // TODO (Incomplete - 4-5h Limit): Dynamic wait-time starvation multiplier was deferred.
    // Currently relies on static vehicle priority weights: EMERGENCY (100) > TRUCK (15) > FORKLIFT (10) > EMPLOYEE (5).
    directionScores[v.direction] += priorityWeight + 5;

    if (v.vehicle_type === 'EMERGENCY') {
      if (['NORTH', 'SOUTH'].includes(v.direction)) {
        emergencyCount.NORTH_SOUTH++;
      } else {
        emergencyCount.EAST_WEST++;
      }
    }
  }

  const northSouthScore = directionScores.NORTH + directionScores.SOUTH;
  const eastWestScore = directionScores.EAST + directionScores.WEST;

  return {
    NORTH_SOUTH: northSouthScore,
    EAST_WEST: eastWestScore,
    directionScores,
    emergencyCount
  };
}

module.exports = {
  validateSensorEvent,
  processSensorEvent,
  calculatePhaseScores
};
