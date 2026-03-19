import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema({
  id: Number,
  x: Number,
  y: Number,
  alive: Boolean,
  minNeighborDist: Number,
  voronoiArea: Number,
}, { _id: false });

const simulationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Configuration
  config: {
    numNodes: Number,
    envType: { type: String, enum: ['Indoor', 'Outdoor'] },
    areaWidth: Number,
    areaHeight: Number,
    sensorType: { type: String, enum: ['Temperature', 'Humidity', 'Motion'] },
    batteryType: String,
    batteryCapacity: Number,
    txInterval: Number,
    placement: { type: String, enum: ['Random', 'Grid', 'Manual'] },
    pathLossExponent: Number,
    wallAttenuation: Number,
    latitude: Number,
    longitude: Number,
  },
  // Results
  results: {
    nodes: [nodeSchema],
    edges: [[Number]],
    metrics: {
      minDist: Number,
      avgDist: Number,
      coveragePct: Number,
      pathLoss: Number,
      isConnected: Boolean,
      batteryLifeDays: Number,
      firstDeathDay: Number,
      networkLifetime: Number,
      totalArea: Number,
      sensorRange: Number,
    },
    timeSeries: [{
      day: Number,
      aliveNodes: Number,
      avgBattery: Number,
      coverage: Number,
      energyConsumed: Number,
    }],
    recommendations: [{
      type: { type: String, enum: ['info', 'warning', 'error'] },
      text: String,
    }],
  },
}, { timestamps: true });

simulationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Simulation', simulationSchema);
