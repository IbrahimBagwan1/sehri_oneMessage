require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');   // registration / login / forgot-password / switch-role
const sendOtpRoutes = require('./routes/auth');        // send-otp
const { testConnection } = require('./config/database');
const userRoutes = require('./routes/users');
const pollRoutes = require('./routes/polls');
const locationRoutes = require('./routes/locations');
const prayerRoutes = require('./routes/prayers');
const adminRoutes = require('./routes/admins');        // create/manage admins + super admins
const trackingRoutes = require('./routes/tracking');   // rider management + live tracking
const chatRoutes = require('./routes/chat');           // group chat + Socket.IO backed messaging
const donationsRoutes = require('./routes/donations'); // user-facing donation submit + history
const adminDonationsRoutes = require('./routes/adminDonations'); // super-admin donation review
const feedbackRoutes = require('./routes/feedback');   // user feedback + admin review
const quranRoutes = require('./routes/quran');         // Quran chapters + verses (served from our DB)
const duaRoutes = require('./routes/dua');             // Dua categories + entries (served from our DB)
const paymentRoutes = require('./routes/payment');     // payment contact + hosted page URL
const broadcastRoutes = require('./routes/broadcasts'); // super-admin push broadcasts
const path = require('path');
const { initSocket } = require('./services/socketService');
const chatGroupSync = require('./services/chatGroupSync');
const logger = require('./utils/logger');
const { error } = require('./utils/response');

const app = express();

// Trust the first reverse proxy (ngrok / nginx / cloud load balancer) so
// req.protocol reflects the original https instead of http-behind-lb. This
// makes payment.js return correct https:// URLs.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security & observability middleware — must come first
// ---------------------------------------------------------------------------
app.use(helmet()); // Sets secure HTTP headers (XSS, clickjacking, MIME sniffing, etc.)

// Route morgan output through winston so we get one unified log stream
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

// Allow all origins in development; lock down via CORS_ORIGIN env var in production
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send('Sehri backend is running');
});

// Health check for uptime monitors / container orchestrators
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', sendOtpRoutes);
app.use('/api/users', userRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/locations', locationRoutes);   // public — used by registration screen
app.use('/api/prayers', prayerRoutes);
app.use('/api/admin', adminRoutes);          // super_admin — manage zone admins
app.use('/api/tracking', trackingRoutes);    // rider login, live tracking, rider management
app.use('/api/chat', chatRoutes);            // group chat rooms + REST message history
app.use('/api/donations', donationsRoutes);         // user donation submit + own history
app.use('/api/admin/donations', adminDonationsRoutes); // super-admin donation review
app.use('/api/feedback', feedbackRoutes);           // user feedback submission + admin review
app.use('/api/quran', quranRoutes);                 // 114 surahs, verses + translation (from our DB)
app.use('/api/dua', duaRoutes);                     // dua categories + entries + featured-today
app.use('/api/payment', paymentRoutes);             // payment contact + hosted page URL (public)
app.use('/api/broadcasts', broadcastRoutes);        // super-admin — send push to a zone or all users

// Static public/ folder — hosts /payment.html (opened by iOS Safari from
// the Donate screen) plus any future static assets. Kept AFTER the /api
// routes and BEFORE the 404 handler so it can't shadow an API route.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  extensions: ['html'],
}));

// ---------------------------------------------------------------------------
// 404 for unmatched API routes — hit before the error handler
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return error(res, { statusCode: 404, message: `Route not found: ${req.method} ${req.path}` });
  }
  next();
});

// ---------------------------------------------------------------------------
// Global error handler
// Must be registered AFTER all routes. Express identifies a 4-argument
// middleware as an error handler. Controllers call next(err) to reach here.
//
// Handles two categories:
//  • Operational errors (AppError.isOperational = true): known, expected
//    failures like cooldown violations, invalid OTPs, not-found, etc.
//    We respond with the error's own statusCode and message.
//  • Programming / unexpected errors: we log the full stack and respond
//    with a generic 500 so internal details are never leaked to the client.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.isOperational) {
    return error(res, {
      statusCode: err.statusCode || 400,
      message: err.message,
    });
  }

  // Unexpected error — log it fully, hide details from client
  logger.error(err.stack || err.message);
  return error(res, {
    statusCode: 500,
    message: 'Internal server error',
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;

// Wrap Express in a plain Node HTTP server so Socket.IO can share the same
// port. app.listen() internally does this too, but we need the httpServer
// reference before listening so we can pass it to initSocket().
const httpServer = http.createServer(app);

testConnection()
  .then(() => {
    // Attach Socket.IO to the HTTP server (must happen before listen)
    initSocket(httpServer);

    // Bind to 0.0.0.0 so phones on the same network (or via ngrok) can reach the server
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT}`);
    });

    // Provision a chat group for any zone that hasn't got one, then reconcile
    // every zone-backed group's membership. Deliberately AFTER listen and
    // deliberately not awaited: it is a self-healing background task, and a
    // hiccup in it must not keep the API from coming up. Every entitlement
    // change during the day reconciles its own zone; this is the backstop
    // that catches anything those hooks missed.
    chatGroupSync.bootstrap().catch((err) => {
      logger.error(`[chatSync] Bootstrap failed: ${err.name}: ${err.message}`);
    });
  })
  .catch((err) => {
    logger.error(`Failed to connect to the database: ${err.message}`);
    process.exit(1);
  });
