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
const logger = require('./utils/logger');
const { error } = require('./utils/response');

const app = express();

// ---------------------------------------------------------------------------
// Security & observability middleware — must come first
// ---------------------------------------------------------------------------
app.use(helmet()); // Sets secure HTTP headers (XSS, clickjacking, MIME sniffing, etc.)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')); // Request logging

// Allow all origins in development; lock down via CORS_ORIGIN env var in production
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send('Sehri backend is running');
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', sendOtpRoutes);
app.use('/api/users', userRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/locations', locationRoutes);   // public — used by registration screen
app.use('/api/prayers', prayerRoutes);
app.use('/api/admin', adminRoutes);          // super_admin — manage zone admins
app.use('/api/tracking', trackingRoutes);    // rider login, live tracking, rider management

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
  })
  .catch((err) => {
    logger.error(`Failed to connect to the database: ${err.message}`);
    process.exit(1);
  });
