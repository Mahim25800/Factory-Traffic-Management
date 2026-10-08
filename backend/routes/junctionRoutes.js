const express = require('express');
const router = express.Router();
const db = require('../database/db');
const trafficEngine = require('../domain/trafficEngine');

router.get('/', (req, res) => {
  const junctions = db.listJunctions();
  res.json({
    success: true,
    count: junctions.length,
    junctions
  });
});

// POST /api/junctions (Listed in Section 10.1 Minimum APIs)
// Deferred to Phase 2 to prioritize rock-solid safety invariants on Junction A within 4-5h limit
router.post('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not Implemented',
    message: 'Dynamic junction creation (POST /api/junctions) was deferred due to the 4-5 hour time limit. The system is dedicated to Junction A safety.'
  });
});

router.get('/:id', (req, res) => {
  const junction = db.getJunction(req.params.id);
  if (!junction) {
    return res.status(404).json({ error: `Junction ${req.params.id} not found` });
  }
  res.json({ success: true, junction });
});

router.get('/:id/status', (req, res) => {
  const junctionId = req.params.id;
  const junction = db.getJunction(junctionId);

  if (!junction) {
    return res.status(404).json({ error: `Junction ${junctionId} not found` });
  }

  const queues = db.getQueueCounts(junctionId);
  const isTransitioning = !!trafficEngine.transitionLocks.get(junctionId);

  res.json({
    junction_id: junction.id,
    name: junction.name,
    mode: junction.mode,
    phase: junction.current_phase,
    controller_status: junction.controller_status,
    desired_signals: junction.desired_signals,
    actual_signals: junction.actual_signals,
    queues: queues,
    is_transitioning: isTransitioning,
    last_updated: junction.last_updated
  });
});

module.exports = router;
