import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config';
import { csrfGuard } from './auth/middleware';
import { HttpError } from './lib/errors';
import { api } from './routes/api';
import { prisma } from './db';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });
  app.use('/api', csrfGuard, api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Uç nokta bulunamadı.' } }));

  // Production: serve the built client from the same origin (cookies + websockets work without CORS)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof SyntaxError) return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Geçersiz JSON.' } });
    console.error('Unhandled error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Sunucu hatası. Lütfen tekrar deneyin.' } });
  });
  return app;
}
