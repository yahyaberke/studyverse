import { createServer } from 'node:http';
import { ACHIEVEMENTS } from '@studyverse/shared';
import { config } from './config';
import { prisma } from './db';
import { createApp } from './app';
import { createSocketServer } from './realtime/socket';
import { sweepStaleSessions } from './services/sessions';

async function main() {
  // keep the achievement catalog in the DB in sync with shared/rules.ts
  for (const a of ACHIEVEMENTS) await prisma.achievement.upsert({ where: { key: a.key }, update: a, create: a });

  const http = createServer(createApp());
  createSocketServer(http);
  const sweeper = setInterval(() => sweepStaleSessions().catch((e) => console.error('sweep failed', e)), 60_000);

  http.listen(config.PORT, () => console.log(`🚀 StudyVerse API on http://localhost:${config.PORT}`));
  const shutdown = async () => {
    clearInterval(sweeper);
    http.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Startup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
