const express = require('express');
const router = express.Router();
const controllerAdapter = require('../domain/controllerAdapter');

router.post('/', (req, res) => {
  const event = req.body;
  if (!event || typeof event !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid controller event payload' });
  }

  const result = controllerAdapter.handleControllerAcknowledgement(event);

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.status(200).json(result);
});

module.exports = router;
