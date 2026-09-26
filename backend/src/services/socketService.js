'use strict';

const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const { resolveZone } = require('../utils/resolveZone');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Module-level Socket.IO instance.
// Initialised once in server.js via initSocket(httpServer).
// Controllers + services import the emitter helpers to publish events
// without passing the io instance around.
// ---------------------------------------------------------------------------
let io = null;

/**
 * Attach Socket.IO to the existing Node HTTP server.
 * Must be called once, right after app.listen() in server.js.
 *
 * @param {import('http').Server} httpServer
 */
const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    // Ping every 25 s, disconnect if no pong within 60 s.
    // Keeps connections alive on mobile networks without leaking sockets.
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // ---------------------------------------------------------------------------
  // JWT authentication middleware
  // Client sends { auth: { token: '<access_token>' } } on io.connect().
  // ---------------------------------------------------------------------------
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication token missing'));
    try {
      const decoded = verifyAccessToken(token);
      socket.user = decoded; // { id, role, zone_location_id?, user_id? }
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ---------------------------------------------------------------------------
  // Connection handler
  // ---------------------------------------------------------------------------
  io.on('connection', (socket) => {
    const { id: accountId, role, user_id, zone_location_id } = socket.user;
    // The effective user identity (same logic as requireUserAccess middleware).
    const effectiveUserId = role === 'user' ? accountId : (user_id || accountId);

    logger.info(`[socket] connect  role=${role}  user=${effectiveUserId}  socket=${socket.id}`);

    // Every connected user joins their own user room so per-user events
    // (eta_update, direct notifications) can target them.
    socket.join(`user:${effectiveUserId}`);

    // -----------------------------------------------------------------------
    // Chat rooms — existing pattern, unchanged.
    // -----------------------------------------------------------------------
    socket.on('join_group', ({ group_id } = {}) => {
      if (!group_id) return;
      socket.join(`group:${group_id}`);
    });

    socket.on('leave_group', ({ group_id } = {}) => {
      if (!group_id) return;
      socket.leave(`group:${group_id}`);
    });

    // -----------------------------------------------------------------------
    // Live tracking — client subscribes when the track screen mounts.
    //
    // Payload (optional): { zone_id }.
    //   1. If the client sends a zone id, we join that zone room.
    //   2. Else if the JWT already carries `zone_location_id` (admin or
    //      rider tokens), fall back to that.
    //   3. Else (role='user' — JWTs for plain users deliberately do NOT
    //      carry zone_location_id), look up the user's linked User row
    //      and walk their location parent chain to find the zone.
    //
    // Every zone-tracking client also joins a `tracking:global` room so
    // riders serving all zones (rider.zone_location_id == null) can
    // broadcast without knowing individual zones.
    //
    // Emitters that publish tracking events:
    //   • emitRiderPosition(zoneId, payload) → `zone:{zoneId}` room
    //     (or → `tracking:global` when zoneId is null)
    //   • emitEtaUpdate(userId, payload)     → `user:{userId}` room
    // -----------------------------------------------------------------------
    const joinZoneRoom = (zoneId) => {
      if (!zoneId) return;
      socket.join(`zone:${zoneId}`);
      logger.info(`[socket] ${effectiveUserId} joined zone:${zoneId}`);
    };

    /**
     * The zone this socket is ENTITLED to watch, derived from the token —
     * never from the client's request.
     *
     * A rider's live GPS goes to the zone room, so joining a room is
     * effectively "let me watch that rider move". This used to honour a
     * client-supplied zone_id verbatim, which meant any signed-in member
     * could subscribe to any zone and follow a rider they had no
     * relationship with. A super admin legitimately oversees everything;
     * everyone else gets exactly their own zone.
     *
     * Returns null when no zone can be established, in which case the
     * socket joins nothing and simply receives no position updates.
     */
    const entitledZoneId = async (requestedZoneId) => {
      // Super admins oversee the whole community, so a request is honoured.
      if (role === 'super_admin') return requestedZoneId || null;

      // Admins and riders carry their zone in the token.
      if (zone_location_id) {
        if (requestedZoneId && requestedZoneId !== zone_location_id) {
          logger.warn(
            `[socket] ${effectiveUserId} (${role}) asked for zone:${requestedZoneId} `
            + `but belongs to zone:${zone_location_id} — using their own`
          );
        }
        return zone_location_id;
      }

      // Plain member — resolve from their own location. Their token
      // deliberately does not carry a zone, so this is the only source.
      const db = require('../models');
      const user = await db.User.findByPk(effectiveUserId, { attributes: ['location_id'] });
      if (!user?.location_id) return null;
      const zone = await resolveZone(user.location_id, db);
      if (!zone) return null;
      if (requestedZoneId && requestedZoneId !== zone.id) {
        logger.warn(
          `[socket] ${effectiveUserId} asked for zone:${requestedZoneId} `
          + `but lives in zone:${zone.id} — using their own`
        );
      }
      return zone.id;
    };

    socket.on('subscribe_tracking', async ({ zone_id } = {}) => {
      try {
        const zoneId = await entitledZoneId(zone_id);
        if (zoneId) {
          joinZoneRoom(zoneId);
          return;
        }
        // No resolvable zone — fall back to the global room so a member
        // whose location has not been set still sees the single rider in a
        // one-zone community. emitRiderPosition only uses this room when a
        // rider has no zone of their own, so it leaks nothing zone-scoped.
        socket.join('tracking:global');
      } catch (err) {
        logger.warn(`[socket] subscribe_tracking failed: ${err.message}`);
      }
    });

    socket.on('unsubscribe_tracking', async ({ zone_id } = {}) => {
      try {
        socket.leave('tracking:global');
        // Leave via the same entitlement path used to join, so a socket
        // cannot be tricked into leaving a room it is not in (harmless) or
        // left subscribed to one it asked to leave (not harmless).
        const zoneId = await entitledZoneId(zone_id);
        if (zoneId) socket.leave(`zone:${zoneId}`);
      } catch (err) {
        logger.warn(`[socket] unsubscribe_tracking failed: ${err.message}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`[socket] disconnect user=${effectiveUserId}  reason=${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`[socket] error user=${effectiveUserId}  ${err.message}`);
    });
  });

  logger.info('[socket] Socket.IO initialised');
  return io;
};

/**
 * Returns the Socket.IO server instance. Throws if initSocket() hasn't
 * been called yet.
 */
const getIO = () => {
  if (!io) throw new Error('Socket.IO has not been initialised. Call initSocket(httpServer) first.');
  return io;
};

// ---------------------------------------------------------------------------
// Chat emitters (kept as-is for chatController)
// ---------------------------------------------------------------------------

const emitNewMessage = (groupId, payload) => {
  if (!io) return;
  io.to(`group:${groupId}`).emit('new_message', payload);
};

const emitMessageDeleted = (groupId, messageId) => {
  if (!io) return;
  io.to(`group:${groupId}`).emit('message_deleted', { message_id: messageId });
};

const emitMemberUpdate = (groupId, event, payload) => {
  if (!io) return;
  io.to(`group:${groupId}`).emit(event, payload);
};

// ---------------------------------------------------------------------------
// Tracking emitters
// ---------------------------------------------------------------------------

/**
 * Broadcast a rider's new position.
 *   • If zoneId is provided → emit to that zone room.
 *   • If zoneId is null (rider serves every zone) → emit to
 *     `tracking:global` so every subscribed user receives it.
 *
 * Consumed by the user track screen to move the marker in real time.
 */
const emitRiderPosition = (zoneId, payload) => {
  if (!io) return;
  const room = zoneId ? `zone:${zoneId}` : 'tracking:global';
  io.to(room).emit('rider_position', payload);
};

/**
 * Send an ETA update to a specific user. The track screen renders
 * "Arriving in X min" from this event.
 */
const emitEtaUpdate = (userId, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit('eta_update', payload);
};

/**
 * Notify a specific user that the rider marked their stop as
 * delivered. The user's track screen switches to the delivered/
 * complete state on receipt. Broadcast per-user rather than per-zone
 * so a rider marking Boys' Hostel PG done doesn't confuse users at
 * other PGs served by the same rider.
 */
const emitStopDelivered = (userId, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit('stop_delivered', payload);
};

/**
 * The rider undid a delivery — it is back on their route.
 * Counterpart to stop_delivered, so a client that already flipped to
 * "delivered" flips back rather than staying wrong until a refresh.
 */
const emitStopReopened = (userId, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit('stop_reopened', payload);
};

module.exports = {
  initSocket,
  getIO,
  // chat
  emitNewMessage,
  emitMessageDeleted,
  emitMemberUpdate,
  // tracking
  emitRiderPosition,
  emitEtaUpdate,
  emitStopDelivered,
  emitStopReopened,
};
