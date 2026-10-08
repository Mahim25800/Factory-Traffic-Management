const express = require('express');
const router = express.Router({ mergeParams: true });
const manualController = require('../domain/manualController');

router.post('/', (req, res) => {
  const junctionId = req.params.id;
  const { command, direction } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Missing command field' });
  }

  if (command === 'MANUAL_GREEN_REQUEST') {
    if (!direction) {
      return res.status(400).json({ error: 'Missing direction for MANUAL_GREEN_REQUEST' });
    }
    const result = manualController.requestManualGreen(junctionId, direction);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  }

  if (command === 'RETURN_TO_AUTOMATIC') {
    const result = manualController.returnToAutomatic(junctionId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  }

  return res.status(400).json({ error: `Unknown command: ${command}` });
});

module.exports = router;
