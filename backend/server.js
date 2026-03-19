import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import authRoutes from './routes/auth.js';
import simulationRoutes from './routes/simulation.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', simulationRoutes);

// Serve frontend in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Connect to DB and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  WSN Simulator Backend`);
    console.log(`  ─────────────────────`);
    console.log(`  Server:   http://localhost:${PORT}`);
    console.log(`  API:      http://localhost:${PORT}/api`);
    console.log(`  MongoDB:  ${process.env.MONGODB_URI}\n`);
  });
}).catch(err => {
  console.error('Failed to start:', err.message);
  // Start anyway without DB for development
  app.listen(PORT, () => {
    console.log(`Server running without DB on port ${PORT}`);
  });
});
