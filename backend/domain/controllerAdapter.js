const db = require('../database/db');
const config = require('../config');

// TODO (Incomplete - 4-5h Limit): Sensor device heartbeat and SENSOR_OFFLINE failure degradation
// was deferred due to assessment time limit. System currently manages physical SIGNAL_CONTROLLER failure.
const pendingTimeouts = new Map();
const activeAutoAckTimers = new Set();
let autoAcknowledgeEnabled = true;

function setAutoAcknowledge(enabled) {
  autoAcknowledgeEnabled = enabled;
}

function clearAllTimeouts() {
  for (const handle of pendingTimeouts.values()) {
    clearTimeout(handle);
  }
  pendingTimeouts.clear();

  for (const handle of activeAutoAckTimers) {
    clearTimeout(handle);
  }
  activeAutoAckTimers.clear();
}

function sendSignalCommand(junctionId, newDesiredSignals) {
  const commandId = `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  db.updateJunction(junctionId, {
    desired_signals: newDesiredSignals
  });

  db.saveCommand(commandId, junctionId, null, JSON.stringify(newDesiredSignals));

  db.addAuditLog(
    junctionId,
    'SIGNAL_STATE_REQUESTED',
    `Signal command ${commandId} dispatched to controller`,
    { command_id: commandId, desired_signals: newDesiredSignals }
  );

  if (pendingTimeouts.has(junctionId)) {
    clearTimeout(pendingTimeouts.get(junctionId));
    pendingTimeouts.delete(junctionId);
  }

  // Watchdog: If physical controller fails to ACK within 5s, mark controller as OFFLINE
  const timeoutHandle = setTimeout(() => {
    handleCommandTimeout(junctionId, commandId);
  }, config.SIGNAL_TIMINGS.CONTROLLER_ACK_TIMEOUT_MS);

  pendingTimeouts.set(junctionId, timeoutHandle);

  // Auto-simulate physical controller ACK after brief network delay in simulation mode
  if (autoAcknowledgeEnabled) {
    const junction = db.getJunction(junctionId);
    if (junction && junction.controller_status === 'ONLINE') {
      const ackTimer = setTimeout(() => {
        activeAutoAckTimers.delete(ackTimer);
        handleControllerAcknowledgement({
          command_id: commandId,
          junction_id: junctionId,
          status: 'ACK',
          actual_state: newDesiredSignals
        });
      }, 100);
      activeAutoAckTimers.add(ackTimer);
    }
  }

  return commandId;
}

function handleCommandTimeout(junctionId, commandId) {
  pendingTimeouts.delete(junctionId);

  db.updateCommandStatus(commandId, 'TIMEOUT');
  db.updateJunction(junctionId, {
    controller_status: 'OFFLINE',
    mode: 'FAILURE'
  });

  db.addAuditLog(
    junctionId,
    'CONTROLLER_TIMEOUT',
    `Controller failed to acknowledge command ${commandId} within timeout. Junction marked DEGRADED / OFFLINE.`,
    { command_id: commandId }
  );
}

function handleControllerAcknowledgement(event) {
  if (!event || typeof event !== 'object') {
    return { success: false, error: 'Invalid event payload' };
  }

  const { command_id, junction_id, status, actual_state } = event;

  if (!junction_id) {
    return { success: false, error: 'Missing junction_id' };
  }

  if (event.device_type === 'SIGNAL_CONTROLLER' || !command_id) {
    const newStatus = status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
    db.updateJunction(junction_id, {
      controller_status: newStatus,
      mode: newStatus === 'OFFLINE' ? 'FAILURE' : 'AUTOMATIC'
    });

    db.addAuditLog(
      junction_id,
      'CONTROLLER_STATUS_CHANGED',
      `Signal controller status changed to ${newStatus}`,
      { status: newStatus }
    );

    return { success: true, message: `Controller status updated to ${newStatus}` };
  }

  if (pendingTimeouts.has(junction_id)) {
    clearTimeout(pendingTimeouts.get(junction_id));
    pendingTimeouts.delete(junction_id);
  }

  const command = db.getCommand(command_id);
  if (!command) {
    db.addAuditLog(
      junction_id,
      'UNKNOWN_COMMAND_ACK',
      `Received ACK for unknown command ${command_id}`,
      { command_id, status }
    );
  }

  if (status === 'ACK') {
    db.updateCommandStatus(command_id, 'ACKNOWLEDGED');

    const currentJunction = db.getJunction(junction_id);
    let confirmedSignals = currentJunction.desired_signals;

    if (actual_state && typeof actual_state === 'object') {
      confirmedSignals = actual_state;
    } else if (actual_state && typeof actual_state === 'string') {
      try {
        confirmedSignals = JSON.parse(actual_state);
      } catch (e) {
        confirmedSignals = currentJunction.desired_signals;
      }
    }

    db.updateJunction(junction_id, {
      actual_signals: confirmedSignals,
      controller_status: 'ONLINE'
    });

    db.addAuditLog(
      junction_id,
      'SIGNAL_STATE_CONFIRMED',
      `Controller confirmed signal state for command ${command_id}`,
      { command_id, actual_signals: confirmedSignals }
    );

    return {
      success: true,
      message: 'Controller acknowledgement processed',
      actual_signals: confirmedSignals
    };
  } else {
    db.updateCommandStatus(command_id, 'FAILED');
    db.updateJunction(junction_id, {
      controller_status: 'DEGRADED',
      mode: 'FAILURE'
    });

    db.addAuditLog(
      junction_id,
      'COMMAND_FAILED',
      `Controller rejected command ${command_id} with status ${status}`,
      { command_id, status }
    );

    return {
      success: false,
      message: `Controller rejected command: ${status}`
    };
  }
}

module.exports = {
  sendSignalCommand,
  handleControllerAcknowledgement,
  setAutoAcknowledge,
  clearAllTimeouts
};
