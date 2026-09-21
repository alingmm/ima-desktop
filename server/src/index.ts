import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer, Server as HTTPServer } from 'http';

import chatRoutes from './routes/chat';
import knowledgeRoutes from './routes/knowledge';
import videoRoutes from './routes/video';
import searchRoutes from './routes/search';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import notesRoutes from './routes/notes';
import localModelRoutes from './routes/local-model';
import settingsRoutes from './routes/settings';

export function createApp(clientDistDir?: string): express.Express {
  const app = express();

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
  app.use('/api/notes', notesRoutes);
  app.use('/api/local-model', localModelRoutes);
  app.use('/api/settings', settingsRoutes);

  // Serve static files in production
  const clientDistPath = clientDistDir || path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });

  return app;
}

export function startServer(port: number, clientDistDir?: string): HTTPServer {
  const app = createApp(clientDistDir);
  const server = createServer(app);

  server.listen(port, () => {
    console.log(`🚀 AI Workstation server running on port ${port}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  return server;
}

// Direct run: ts-node / node
if (require.main === module) {
  const PORT = Number(process.env.DEPLOY_RUN_PORT || process.env.PORT || 3001);
  startServer(PORT);
}

export default createApp();
