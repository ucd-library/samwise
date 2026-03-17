import express from 'express';
import config from './lib/config.js';
import { authMiddleware, modelAccessMiddleware } from './lib/auth.js';
import { modelRouterMiddleware } from './lib/router.js';
import { getModels } from './lib/models.js';
import { buildStreamingProxy } from './lib/streaming-proxy.js';
import logger from './lib/logger.js';
import {logReqMiddleware} from '@ucd-lib/logger';

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();

// ─── Global middleware ────────────────────────────────────────────────────────

// Trust proxies in front of this service (Nginx, Traefik, etc.)
app.set('trust proxy', 1);

// Simple request logger
app.use(logReqMiddleware(logger));

// ─── Health / meta endpoints (no auth required) ───────────────────────────────

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', authEnabled: config.auth.enabled })
);

// ─── Ollama proxy ─────────────────────────────────────────────────────────────
//
// Request pipeline for every /api/* route:
//
//  1. express.json()          – buffer & parse the JSON body so we can read
//                               `body.model` for routing and auth decisions.
//  2. authMiddleware()        – verify the Bearer JWT (no-op when AUTH_ENABLED=false).
//  3. modelRouterMiddleware() – resolve the target Ollama URL from `body.model`;
//                               attaches req.ollamaModel and req.ollamaTarget.
//  4. modelAccessMiddleware() – check the caller has the required role
//                               (no-op when AUTH_ENABLED=false).
//  5. proxyMiddleware         – forward the request to the resolved Ollama instance,
//                               re-serialising the buffered body.
//

const proxyMiddleware = buildStreamingProxy();

app.use('/api/tags', async (req, res) => {
  res.json({
    models: Object.values(await getModels())
  });
});

// Routes that serve a body: generate, chat, embeddings, pull, push, …
app.use(
  '/api',
  // authMiddleware(),
  // modelRouterMiddleware(),
  // modelAccessMiddleware(),
  // express.json({ limit: config.proxy.bodyLimit }),
  proxyMiddleware
);

// ─── Fallback 404 ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled error]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, async () => {
  console.log(`
╔════════════════════════════════════════════╗
║         Samwise Model Proxy                ║
╠════════════════════════════════════════════╣
║  Listening on  http://0.0.0.0:${String(config.port).padEnd(14)}║
║  Auth enabled  ${String(config.auth.enabled).padEnd(28)}║
╚════════════════════════════════════════════╝
  `);

  if (config.auth.enabled) {
    console.log(`  JWT algorithms : ${config.auth.algorithms.join(', ')}`);
    console.log(`  Session TTL    : ${config.session.ttlSeconds}s`);
  }

  await getModels(); // pre-warm model list cache

  console.log('\n  Model routes:');
  if (config.routing.routeMap.size === 0 && !config.routing.defaultUrl) {
    console.warn('  ⚠  No model routes configured! All proxy requests will fail.');
  } else {
    for (const [model, url] of config.routing.routeMap) {
      console.log(`    ${model.padEnd(20)} → ${url}`);
    }
    if (config.routing.defaultUrl) {
      console.log(`    ${'(default)'.padEnd(20)} → ${config.routing.defaultUrl}`);
    }
  }

  console.log('');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully…`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });

  // Force-quit after 10 s if pending requests do not drain
  setTimeout(() => {
    console.error('Forcing exit after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app; // exported for testing
