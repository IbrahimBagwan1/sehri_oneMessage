'use strict';

/**
 * app.js — the Express application, without a listening socket.
 *
 * Split out of server.js so the test suite can drive the real app — every
 * route, middleware and error handler — on an ephemeral port, while
 * server.js keeps the process-level concerns: env validation, the database
 * handshake, Socket.IO, and graceful shutdown.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const logger = require('./utils/logger');
const { error } = require('./utils/response');
const { isProduction, list } = require('./config/env');
const db = require('./models');

const authRoutes = require('./routes/authRoutes');   // registration / login / forgot-password / switch-role / refresh / logout
const sendOtpRoutes = require('./routes/auth');        // send-otp / verify-otp
const userRoutes = require('./routes/users');
const pollRoutes = require('./routes/polls');
const locationRoutes = require('./routes/locations');
const prayerRoutes = require('./routes/prayers');
const adminRoutes = require('./routes/admins');        // create/manage admins + super admins
const trackingRoutes = require('./routes/tracking');   // rider management + live tracking
const chatRoutes = require('./routes/chat');           // group chat + Socket.IO backed messaging
const adminChatRoutes = require('./routes/adminChat'); // chat moderation queue (reports + bans)
const donationsRoutes = require('./routes/donations'); // user-facing donation submit + history
const adminDonationsRoutes = require('./routes/adminDonations'); // super-admin donation review
const feedbackRoutes = require('./routes/feedback');   // user feedback + admin review
const quranRoutes = require('./routes/quran');         // Quran chapters + verses (served from our DB)
const duaRoutes = require('./routes/dua');             // Dua categories + entries (served from our DB)
const paymentRoutes = require('./routes/payment');     // payment contact + hosted page URL
const broadcastRoutes = require('./routes/broadcasts'); // super-admin push broadcasts

/**
 * CORS. The mobile app sends no Origin header, so this only governs
 * browsers. Development allows any origin; production allows exactly the
 * origins in CORS_ORIGIN and, when that is empty, none — env.js already
 * refuses '*' in production.
 */
const corsOrigin = () => {
  if (!isProduction()) return process.env.CORS_ORIGIN ? list(process.env.CORS_ORIGIN) : '*';
  const allowed = list(process.env.CORS_ORIGIN);
  return allowed.length ? allowed : false;
};

/**
 * Map errors thrown by libraries to the response they deserve. Everything
 * not recognised is a bug: logged with its stack, answered with a bare 500.
 */
const classify = (err) => {
  if (err.isOperational) {
    return { statusCode: err.statusCode || 400, message: err.message, code: err.code || null };
  }
  // body-parser: malformed JSON, oversized body.
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'The request body is not valid JSON.', code: 'BAD_JSON' };
  }
  if (err.type === 'entity.too.large') {
    return { statusCode: 413, message: 'The request is too large.', code: 'PAYLOAD_TOO_LARGE' };
  }
  // Sequelize: a unique index lost a race the application check could not
  // see (two taps on "vote", two admins creating the same thing).
  if (err.name === 'SequelizeUniqueConstraintError') {
    return { statusCode: 409, message: 'That already exists.', code: 'DUPLICATE' };
  }
  if (err.name === 'SequelizeValidationError') {
    return {
      statusCode: 422,
      message: err.errors?.[0]?.message || 'Some of the details are not valid.',
      code: 'VALIDATION_FAILED',
    };
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return { statusCode: 409, message: 'That refers to something that no longer exists.', code: 'CONFLICT' };
  }
  return null;
};

const createApp = () => {
  const app = express();

  // One reverse proxy (nginx / a cloud load balancer) in front of the API,
  // so req.ip and req.protocol reflect the client rather than the proxy.
  // Configurable because the right value depends on the hosting topology.
  app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY || '1', 10));
  app.disable('x-powered-by');

  // ---------------------------------------------------------------------
  // Security & observability — must come first
  // ---------------------------------------------------------------------
  app.use(helmet());

  // Routed through winston so there is one log stream, and so the request
  // line passes through the logger's PII redaction.
  app.use(
    morgan(isProduction() ? 'combined' : 'dev', {
      stream: { write: (msg) => logger.info(msg.trim()) },
      skip: (req) => req.path === '/health',
    })
  );

  app.use(cors({
    origin: corsOrigin(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------------
  // Health — liveness is cheap and never touches the database; readiness
  // proves the database answers, for load balancers that should stop
  // routing to an instance that has lost it.
  // ---------------------------------------------------------------------
  app.get('/', (req, res) => res.send('OneMessage API is running'));
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
  app.get('/health/ready', async (req, res) => {
    try {
      await db.sequelize.query('SELECT 1');
      return res.status(200).json({ status: 'ok', db: 'ok' });
    } catch {
      return res.status(503).json({ status: 'unavailable', db: 'unreachable' });
    }
  });

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------
  app.use('/api/auth', authRoutes);
  app.use('/api/auth', sendOtpRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/polls', pollRoutes);
  app.use('/api/locations', locationRoutes);   // public — used by registration screen
  app.use('/api/prayers', prayerRoutes);
  app.use('/api/admin', adminRoutes);          // super_admin — manage zone admins
  app.use('/api/tracking', trackingRoutes);    // rider login, live tracking, rider management
  app.use('/api/chat', chatRoutes);            // group chat rooms + REST message history
  app.use('/api/admin/chat', adminChatRoutes); // moderation queue - reported messages + bans
  app.use('/api/donations', donationsRoutes);         // user donation submit + own history
  app.use('/api/admin/donations', adminDonationsRoutes); // super-admin donation review
  app.use('/api/feedback', feedbackRoutes);           // user feedback submission + admin review
  app.use('/api/quran', quranRoutes);                 // 114 surahs, verses + translation (from our DB)
  app.use('/api/dua', duaRoutes);                     // dua categories + entries + featured-today
  app.use('/api/payment', paymentRoutes);             // payment contact + hosted page URL (public)
  app.use('/api/broadcasts', broadcastRoutes);        // super-admin — send push to a zone or all users

  // Static public/ folder — hosts /payment.html (opened by iOS Safari from
  // the Donate screen). After the /api routes so it can't shadow one.
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    extensions: ['html'],
  }));

  // 404 for unmatched API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return error(res, { statusCode: 404, message: `Route not found: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
    }
    return next();
  });

  // ---------------------------------------------------------------------
  // Global error handler — registered last. Operational and recognised
  // library errors get their real status; anything else is logged in full
  // and answered with a generic 500, so internals never reach a client.
  // ---------------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const known = classify(err);
    if (known) {
      if (known.statusCode >= 500) logger.error(err.stack || err.message);
      return error(res, known);
    }
    logger.error(`${req.method} ${req.path} failed: ${err.stack || err.message}`);
    return error(res, { statusCode: 500, message: 'Internal server error', code: 'INTERNAL' });
  });

  return app;
};

module.exports = { createApp };
