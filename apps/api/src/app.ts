import express from 'express';
import { listenForEvents } from './agents/routines';
import { errorHandler } from './errors';
import { mcpRouter } from './mcp/server';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();
  // Agents' routines start on what happens in a company (decision 0024, phase B).
  listenForEvents();
  app.disable('x-powered-by');
  // Behind a proxy on this machine (Apache): the client's address and https come from its headers.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10mb' }));
  // MCP clients (decision 0023): a personal access token instead of the session cookie.
  app.use('/api/mcp', mcpRouter());
  app.use('/api', apiRouter());
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown address.', problems: [] });
  });
  app.use(errorHandler);
  return app;
}
