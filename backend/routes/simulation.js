import express from 'express';
import jwt from 'jsonwebtoken';
import Simulation from '../models/Simulation.js';
import { optimizePlacement, runSimulation } from '../services/simulationService.js';

const router = express.Router();

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/simulate — run simulation (no auth required for quick use)
router.post('/simulate', (req, res) => {
  try {
    const results = runSimulation(req.body);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/optimize — optimize a provided manual placement (no auth required)
router.post('/optimize', (req, res) => {
  try {
    const results = optimizePlacement(req.body);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/save — save simulation (auth required)
router.post('/save', auth, async (req, res) => {
  try {
    const { config, results } = req.body;
    const simulation = await Simulation.create({
      userId: req.userId,
      config,
      results,
    });
    res.status(201).json({ id: simulation._id, message: 'Simulation saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/results/:id — fetch single simulation
router.get('/results/:id', auth, async (req, res) => {
  try {
    const sim = await Simulation.findOne({ _id: req.params.id, userId: req.userId });
    if (!sim) return res.status(404).json({ error: 'Simulation not found' });
    res.json(sim);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history — list user's simulations
router.get('/history', auth, async (req, res) => {
  try {
    const sims = await Simulation.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('config.envType config.numNodes config.sensorType results.metrics.coveragePct results.metrics.batteryLifeDays createdAt');
    res.json(sims);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
