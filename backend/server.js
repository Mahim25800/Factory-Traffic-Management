const express = require('express');
const cors = require('cors');
const path = require('node:path');

const config = require('./config');
const db = require('./database/db');
const trafficEngine = require('./domain/trafficEngine');

const junctionRoutes = require('./routes/junctionRoutes');
const sensorEventRoutes = require('./routes/sensorEventRoutes');
const commandRoutes = require('./routes/commandRoutes');
const controllerEventRoutes = require('./routes/controllerEventRoutes');
const historyRoutes = require('./routes/historyRoutes');

db.initDb();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/junctions', junctionRoutes);
app.use('/api/sensor-events', sensorEventRoutes);
app.use('/api/junctions/:id/commands', commandRoutes);
app.use('/api/controller-events', controllerEventRoutes);
app.use('/api/junctions/:id/history', historyRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Serve frontend static assets
app.use(express.static(path.join(__dirname, '../frontend')));

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

if (require.main === module) {
  trafficEngine.initJunctionEngine('A');

  const server = app.listen(config.PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚦 Factory Traffic Management System Backend running!`);
    console.log(`📍 Port: ${config.PORT}`);
    console.log(`🌐 Dashboard: http://localhost:${config.PORT}`);
    console.log(`📡 API Base: http://localhost:${config.PORT}/api`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping traffic engine and shutting down gracefully...');
    trafficEngine.stopJunctionEngine('A');
    server.close(() => {
      db.closeDb();
      console.log('Server stopped cleanly.');
      process.exit(0);
    });
  });
}

module.exports = app;
