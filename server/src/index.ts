import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

import chatRoutes from './routes/chat.js';
import knowledgeRoutes from './routes/knowledge.js';
import videoRoutes from './routes/video.js';
import searchRoutes from './routes/search.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: import("express").Express = express();
const PORT = process.env.DEPLOY_RUN_PORT || process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/user', userRoutes);

// Serve static files in production
const clientDistPath = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`🚀 AI Workstation server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
