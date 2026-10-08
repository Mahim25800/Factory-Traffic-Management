const express = require('express');
const router = express.Router();
const db = require('../database/db');
const queueManager = require('../domain/queueManager');
const emergencyManager = require('../domain/emergencyManager');

router.post('/', (req, res) => {
  const event = req.body;

  if (event && event.junction_id) {
    const junction = db.getJunction(event.junction_id);
    if (!junction) {
      return res.status(404).json({ error: `Unknown junction: ${event.junction_id}` });
    }
  }

  const result = queueManager.processSensorEvent(event);

  if (!result.success && result.status) {
    return res.status(result.status).json({ error: result.error });
  }

  // Trigger immediate preemption if non-duplicate emergency arrival
  if (!result.duplicate && event.event_type === 'VEHICLE_ARRIVED' && event.vehicle_type === 'EMERGENCY') {
    emergencyManager.handleEmergencyVehicle(event.junction_id, event.direction, event.vehicle_id);
  }

  // Evaluate emergency clearance if emergency vehicle cleared
  if (!result.duplicate && event.event_type === 'VEHICLE_CLEARED' && event.vehicle_type === 'EMERGENCY') {
    emergencyManager.handleEmergencyCleared(event.junction_id, event.vehicle_id);
  }

  res.status(200).json(result);
});

module.exports = router;
