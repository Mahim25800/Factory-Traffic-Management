const db = require('../database/db');
const config = require('../config');
const trafficEngine = require('./trafficEngine');

// TODO (Incomplete - 4-5h Limit): Simultaneous conflicting emergency arbitration
// (e.g., North Ambulance vs East Fire Truck at identical timestamps) was deferred.
// Current implementation handles emergency preemption safely on FIFO arrival basis.
function handleEmergencyVehicle(junctionId, direction, vehicleId) {
  const junction = db.getJunction(junctionId);
  if (!junction) return { success: false, error: 'Junction not found' };

  const targetPhase = ['NORTH', 'SOUTH'].includes(direction)
    ? config.PHASES.NORTH_SOUTH
    : config.PHASES.EAST_WEST;

  db.updateJunction(junctionId, { mode: config.MODES.EMERGENCY });

  db.addAuditLog(
    junctionId,
    'EMERGENCY_DETECTED',
    `Emergency vehicle ${vehicleId || 'EV'} approaching from ${direction}. Preempting signals for phase ${targetPhase}.`,
    { direction, vehicleId, targetPhase }
  );

  if (junction.current_phase === targetPhase && junction.desired_signals[direction] === 'GREEN') {
    return {
      success: true,
      message: `Emergency vehicle direction ${direction} already has GREEN. Priority maintained.`,
      targetPhase
    };
  }

  // Preemption initiates safe multi-step transition; safety clearance (Yellow + All-Red) is strictly preserved
  const initiated = trafficEngine.transitionToPhase(junctionId, targetPhase);

  return {
    success: true,
    message: `Safe emergency transition to ${targetPhase} initiated.`,
    transitionStarted: initiated,
    targetPhase
  };
}

function handleEmergencyCleared(junctionId, vehicleId) {
  const waiting = db.getWaitingVehicles(junctionId);
  const remainingEmergencies = waiting.filter(v => v.vehicle_type === 'EMERGENCY');

  if (remainingEmergencies.length === 0) {
    db.updateJunction(junctionId, { mode: config.MODES.AUTOMATIC });

    db.addAuditLog(
      junctionId,
      'EMERGENCY_CLEARED',
      `Emergency cleared (vehicle: ${vehicleId || 'all'}). Returning junction to AUTOMATIC mode.`,
      { vehicleId }
    );

    return {
      success: true,
      mode: config.MODES.AUTOMATIC,
      message: 'All emergency vehicles cleared. Returned to AUTOMATIC mode.'
    };
  } else {
    const nextEmergency = remainingEmergencies[0];
    handleEmergencyVehicle(junctionId, nextEmergency.direction, nextEmergency.vehicle_id);

    return {
      success: true,
      mode: config.MODES.EMERGENCY,
      message: `Remaining emergency vehicle ${nextEmergency.vehicle_id} at ${nextEmergency.direction} prioritized.`
    };
  }
}

module.exports = {
  handleEmergencyVehicle,
  handleEmergencyCleared
};
