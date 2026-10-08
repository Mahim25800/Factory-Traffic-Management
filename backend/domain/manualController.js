const db = require('../database/db');
const config = require('../config');
const trafficEngine = require('./trafficEngine');

function requestManualGreen(junctionId, direction) {
  const junction = db.getJunction(junctionId);
  if (!junction) {
    return { success: false, error: 'Junction not found' };
  }

  if (!config.DIRECTIONS.includes(direction)) {
    return { success: false, error: `Invalid direction: ${direction}. Must be one of ${config.DIRECTIONS.join(', ')}` };
  }

  // Safety rule: Emergency vehicles have absolute priority over manual control
  if (junction.mode === config.MODES.EMERGENCY) {
    return {
      success: false,
      error: 'Cannot apply manual override while EMERGENCY mode is active.'
    };
  }

  const targetPhase = ['NORTH', 'SOUTH'].includes(direction)
    ? config.PHASES.NORTH_SOUTH
    : config.PHASES.EAST_WEST;

  db.updateJunction(junctionId, { mode: config.MODES.MANUAL });

  db.addAuditLog(
    junctionId,
    'MANUAL_OVERRIDE',
    `Administrator requested manual GREEN for direction ${direction} (Phase: ${targetPhase})`,
    { direction, targetPhase }
  );

  // TODO (Incomplete - 4-5h Limit): Automated inactivity watchdog timeout to revert abandoned
  // manual overrides after 60s was deferred due to assessment time limit.
  // The junction remains in MANUAL mode until an operator explicitly calls RETURN_TO_AUTOMATIC.

  const transitionStarted = trafficEngine.transitionToPhase(junctionId, targetPhase);

  return {
    success: true,
    message: `Manual green requested for ${direction}. Safe transition to ${targetPhase} initiated.`,
    targetPhase,
    transitionStarted
  };
}

function returnToAutomatic(junctionId) {
  const junction = db.getJunction(junctionId);
  if (!junction) {
    return { success: false, error: 'Junction not found' };
  }

  db.updateJunction(junctionId, { mode: config.MODES.AUTOMATIC });

  const desc = 'Administrator requested return to AUTOMATIC mode.';

  db.addAuditLog(
    junctionId,
    'RETURN_TO_AUTOMATIC',
    desc,
    {}
  );

  trafficEngine.startAutomaticLoop(junctionId);

  return {
    success: true,
    message: desc,
    mode: config.MODES.AUTOMATIC
  };
}

function clearAllTimeouts() {
  // Watchdog timers omitted in simplified intern scope
}

module.exports = {
  requestManualGreen,
  returnToAutomatic,
  clearAllTimeouts
};
