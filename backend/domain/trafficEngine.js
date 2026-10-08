const db = require('../database/db');
const config = require('../config');
const controllerAdapter = require('./controllerAdapter');
const queueManager = require('./queueManager');

const transitionLocks = new Map();
const tickIntervals = new Map();
const phaseStartTimes = new Map();
const activeTransitionTimers = new Map();

function isSafeSignalState(signals) {
  if (!signals) return false;
  const northSouthGreen = signals.NORTH === 'GREEN' || signals.SOUTH === 'GREEN';
  const eastWestGreen = signals.EAST === 'GREEN' || signals.WEST === 'GREEN';

  // Safety Invariant 1: Conflicting phases must never simultaneously receive GREEN
  if (northSouthGreen && eastWestGreen) {
    return false;
  }

  // Safety Invariant 2: Conflicting phases must not both be YELLOW simultaneously
  const northSouthYellow = signals.NORTH === 'YELLOW' || signals.SOUTH === 'YELLOW';
  const eastWestYellow = signals.EAST === 'YELLOW' || signals.WEST === 'YELLOW';
  if (northSouthYellow && eastWestYellow) {
    return false;
  }

  return true;
}

function buildSignalMap(activePhase, activeColor) {
  const signals = {
    NORTH: 'RED',
    SOUTH: 'RED',
    EAST: 'RED',
    WEST: 'RED'
  };

  if (activePhase === config.PHASES.ALL_RED) {
    return signals;
  }

  const directions = config.PHASE_DIRECTIONS[activePhase] || [];
  for (const dir of directions) {
    signals[dir] = activeColor;
  }

  return signals;
}

function initJunctionEngine(junctionId) {
  let junction = db.getJunction(junctionId);
  if (!junction) {
    junction = db.createJunction(junctionId, `Junction ${junctionId}`);
  }

  // Crash recovery: safely clear intersection with ALL_RED before serving traffic
  const safeClearanceSignals = buildSignalMap(config.PHASES.ALL_RED, 'RED');
  db.updateJunction(junctionId, {
    desired_signals: safeClearanceSignals,
    actual_signals: safeClearanceSignals,
    current_phase: config.PHASES.ALL_RED
  });
  db.addAuditLog(junctionId, 'RESTART_RECOVERY', 'Server startup: reset junction to ALL_RED clearance for safety', {
    safeSignals: safeClearanceSignals
  });

  setTimeout(() => {
    transitionToPhase(junctionId, config.PHASES.NORTH_SOUTH, () => {
      startAutomaticLoop(junctionId);
    });
  }, 1000);
}

function startAutomaticLoop(junctionId) {
  if (tickIntervals.has(junctionId)) {
    clearInterval(tickIntervals.get(junctionId));
  }

  phaseStartTimes.set(junctionId, Date.now());

  const interval = setInterval(() => {
    evaluateAutomaticTraffic(junctionId);
  }, 2000);

  tickIntervals.set(junctionId, interval);
}

function evaluateAutomaticTraffic(junctionId) {
  const junction = db.getJunction(junctionId);
  if (!junction) return;

  if (junction.mode !== config.MODES.AUTOMATIC) return;
  if (transitionLocks.get(junctionId)) return;

  const currentPhase = junction.current_phase;
  const elapsedMs = Date.now() - (phaseStartTimes.get(junctionId) || 0);

  if (elapsedMs < config.SIGNAL_TIMINGS.GREEN_DURATION_MS) {
    return;
  }

  const scores = queueManager.calculatePhaseScores(junctionId);
  const otherPhase = currentPhase === config.PHASES.NORTH_SOUTH
    ? config.PHASES.EAST_WEST
    : config.PHASES.NORTH_SOUTH;

  if (scores[otherPhase] > scores[currentPhase] || (scores[otherPhase] > 0 && scores[currentPhase] === 0)) {
    transitionToPhase(junctionId, otherPhase);
  }
}

// Multi-step clearance sequence: Active GREEN -> Active YELLOW -> ALL RED -> Target GREEN
function transitionToPhase(junctionId, targetPhase, onComplete) {
  if (transitionLocks.get(junctionId)) {
    return false;
  }

  const junction = db.getJunction(junctionId);
  if (!junction) return false;

  const currentPhase = junction.current_phase;
  if (currentPhase === targetPhase && junction.desired_signals.NORTH === 'GREEN') {
    if (onComplete) onComplete();
    return true;
  }

  transitionLocks.set(junctionId, true);

  db.addAuditLog(
    junctionId,
    'SIGNAL_TRANSITION_STARTED',
    `Safe transition started: ${currentPhase} -> ${targetPhase}`,
    { fromPhase: currentPhase, toPhase: targetPhase }
  );

  // Step 1: Active phase to YELLOW
  const step1Signals = buildSignalMap(currentPhase, config.SIGNAL_STATES.YELLOW);
  if (!isSafeSignalState(step1Signals)) {
    console.error('Safety violation prevented in Step 1:', step1Signals);
    transitionLocks.set(junctionId, false);
    return false;
  }

  controllerAdapter.sendSignalCommand(junctionId, step1Signals);

  // Step 2: After YELLOW duration, switch to ALL_RED clearance
  const timer1 = setTimeout(() => {
    const step2Signals = buildSignalMap(config.PHASES.ALL_RED, config.SIGNAL_STATES.RED);
    db.updateJunction(junctionId, { current_phase: config.PHASES.ALL_RED });
    controllerAdapter.sendSignalCommand(junctionId, step2Signals);

    // Step 3: After ALL_RED duration, switch to target GREEN
    const timer2 = setTimeout(() => {
      const step3Signals = buildSignalMap(targetPhase, config.SIGNAL_STATES.GREEN);
      if (!isSafeSignalState(step3Signals)) {
        console.error('Safety violation prevented in Step 3:', step3Signals);
        transitionLocks.set(junctionId, false);
        return false;
      }

      db.updateJunction(junctionId, { current_phase: targetPhase });
      controllerAdapter.sendSignalCommand(junctionId, step3Signals);

      phaseStartTimes.set(junctionId, Date.now());
      transitionLocks.set(junctionId, false);

      if (onComplete) onComplete();
    }, config.SIGNAL_TIMINGS.ALL_RED_DURATION_MS);

    activeTransitionTimers.set(`${junctionId}_step2`, timer2);
  }, config.SIGNAL_TIMINGS.YELLOW_DURATION_MS);

  activeTransitionTimers.set(`${junctionId}_step1`, timer1);

  return true;
}

function stopJunctionEngine(junctionId) {
  if (tickIntervals.has(junctionId)) {
    clearInterval(tickIntervals.get(junctionId));
    tickIntervals.delete(junctionId);
  }

  const t1 = activeTransitionTimers.get(`${junctionId}_step1`);
  if (t1) { clearTimeout(t1); activeTransitionTimers.delete(`${junctionId}_step1`); }
  const t2 = activeTransitionTimers.get(`${junctionId}_step2`);
  if (t2) { clearTimeout(t2); activeTransitionTimers.delete(`${junctionId}_step2`); }

  transitionLocks.delete(junctionId);
  phaseStartTimes.delete(junctionId);
}

module.exports = {
  isSafeSignalState,
  buildSignalMap,
  initJunctionEngine,
  transitionToPhase,
  evaluateAutomaticTraffic,
  startAutomaticLoop,
  stopJunctionEngine,
  transitionLocks
};
