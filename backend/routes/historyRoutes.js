const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../database/db');

router.get('/', (req, res) => {
  const junctionId = req.params.id;
  const limit = parseInt(req.query.limit, 10) || 50;

  // TODO (Incomplete - 4-5h Limit): Event filtering (?event_type=), timestamp range filters
  // (?from=, ?to=), and cursor-based pagination were deferred. Currently returns recent raw audit history.
  const history = db.getAuditHistory(junctionId, limit);

  res.json({
    success: true,
    junction_id: junctionId,
    count: history.length,
    history
  });
});

module.exports = router;
