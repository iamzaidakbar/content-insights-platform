import mongoose from 'mongoose';

import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export async function connectDB(): Promise<void> {
  await mongoose.connect(config.mongodbUri);
  logger.info('Connected to MongoDB');
}
