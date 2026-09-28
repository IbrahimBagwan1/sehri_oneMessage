'use strict';

// quiet: dotenv 17 otherwise prints a banner to stdout on every boot.
require('dotenv').config({ quiet: true });

const http = require('http');
const logger = require('./utils/logger');
const { validateEnv } = require('./config/env');

// Validate before anything else is required: models and services read the
// environment at load time, and a bad value should stop the process with a
// clear list, not surface later as a confusing downstream failure.
try {
  const { warnings } = validateEnv();
  for (const w of warnings) logger.warn(`[env] ${w}`);
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

const { createApp } = require('./app');
const { testConnection, sequelize } = require('./config/database');
const { initSocket, getIO } = require('./services/socketService');
const chatGroupSync = require('./services/chatGroupSync');
const authSessionService = require('./services/authSessionService');
const loginThrottleService = require('./services/loginThrottleService');

const PORT = Number.parseInt(process.env.PORT || '5000', 10);
const SESSION_PURGE_MS = 6 * 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 10 * 1000;

const app = createApp();

// A plain Node HTTP server so Socket.IO can share the port.
const httpServer = http.createServer(app);

// Bound how long a client may hold a connection open. The defaults (five
// minutes per request) let a slow or malicious client pin sockets. Uploads
// of a payment screenshot on a slow network are the longest legitimate
// request, which the app itself times out at 30 s.
httpServer.requestTimeout = 60 * 1000;
httpServer.headersTimeout = 20 * 1000;
// Longer than a typical load balancer's 60 s idle timeout, so the balancer
// closes idle keep-alive connections first and never sends to a socket
// this process has just closed.
httpServer.keepAliveTimeout = 65 * 1000;

let purgeTimer = null;
let shuttingDown = false;

/**
 * Stop taking new work, let in-flight requests finish, then release the
 * database. Platform deploys send SIGTERM and wait a few seconds before
 * SIGKILL; without this every deploy cut off whatever was mid-request —
 * a vote, a donation upload, a delivered stop.
 */
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] ${signal} received — shutting down`);

  const force = setTimeout(() => {
    logger.error('[server] shutdown grace period elapsed — forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();

  if (purgeTimer) clearInterval(purgeTimer);

  try { getIO().close(); } catch (_) { /* socket layer never started */ }

  httpServer.close(async () => {
    try {
      await sequelize.close();
    } catch (err) {
      logger.warn(`[server] error closing the database pool: ${err.message}`);
    }
    logger.info('[server] shutdown complete');
    process.exit(0);
  });
  // Idle keep-alive sockets would otherwise hold close() open until they
  // time out on their own.
  httpServer.closeIdleConnections?.();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A rejected promise nobody awaited is a bug, but not one worth taking the
// whole API down for: log it with its stack so it gets fixed.
process.on('unhandledRejection', (reason) => {
  logger.error(`[process] unhandled rejection: ${reason?.stack || reason}`);
});
// An uncaught exception leaves the process in an unknown state. Log it and
// exit; the process manager restarts a clean instance.
process.on('uncaughtException', (err) => {
  logger.error(`[process] uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});

testConnection()
  .then(() => {
    initSocket(httpServer);

    // 0.0.0.0 so devices on the same network (or a tunnel) can reach it.
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT}`);
    });

    // Provision a chat group for any zone without one and reconcile every
    // zone group's membership. Not awaited: a self-healing background task
    // must not keep the API from coming up.
    chatGroupSync.bootstrap().catch((err) => {
      logger.error(`[chatSync] Bootstrap failed: ${err.name}: ${err.message}`);
    });

    // Housekeeping for ended sessions. Idempotent, so every instance may
    // run it; unref'd so it never holds the process open on shutdown.
    const purge = () => Promise.all([
      authSessionService.purgeStaleSessions()
        .catch((err) => logger.warn(`[auth] session purge failed: ${err.message}`)),
      loginThrottleService.purgeStale()
        .catch((err) => logger.warn(`[auth] login throttle purge failed: ${err.message}`)),
    ]);
    purge();
    purgeTimer = setInterval(purge, SESSION_PURGE_MS);
    purgeTimer.unref();
  })
  .catch((err) => {
    logger.error(`Failed to connect to the database: ${err.message}`);
    process.exit(1);
  });
