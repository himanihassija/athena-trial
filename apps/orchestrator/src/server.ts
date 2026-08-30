/**
 * Orchestrator entry point — PS31 §2 "Orchestration Backend".
 *
 * A long-lived process rather than serverless functions, for two concrete
 * reasons: the floor state machine needs a single authoritative writer per
 * classroom, and the `agora-agents` AgentSession object must stay in memory to
 * issue interrupt/speak/update calls against a running agent.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { classroomRoutes } from './routes/classroom.js';
import { inspectRoutes } from './routes/inspect.js';
import { completionsRoutes } from './routes/completions.js';
import { considerSilenceInterjection } from './classroomController.js';
import { listSessions } from './state/sessionRegistry.js';
import { stopAllAgents } from './agent/agentLifecycle.js';

/**
 * How often the silence-gap check runs (§3.3b). Fast enough that a natural pause
 * is caught while it is still a pause, slow enough not to churn.
 */
const TICK_INTERVAL_MS = 1000;

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

app.get('/health', async () => ({
  ok: true,
  sessions: listSessions().length,
  model: config.llmModel,
  stt: config.sttLanguage,
}));

await app.register(classroomRoutes);
await app.register(inspectRoutes);
await app.register(completionsRoutes);

/**
 * The silence tick. Kept out of the request path because the condition it
 * watches for is the *absence* of activity — nothing else would wake it.
 */
const tick = setInterval(() => {
  for (const session of listSessions()) {
    if (session.endedAt !== null) continue;
    void considerSilenceInterjection(session).catch((error) => {
      app.log.warn({ err: error, sessionId: session.sessionId }, 'silence tick failed');
    });
  }
}, TICK_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  clearInterval(tick);
  // Agents left running in Agora would keep billing and occupy PCU slots.
  await stopAllAgents();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
