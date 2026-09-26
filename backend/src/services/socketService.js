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
    // Live GPS goes to a per-captain run room, `team:{captainId}`, not to
    // a zone room. A captain may cover several zones at once, which one
    // zone id cannot express — the position would reach one of their zones
    // and the rest would watch a frozen map.
    //
    // Emitters that publish tracking events:
    //   • emitTeamPosition(captainId, payload) → `team:{captainId}` room
    //     (or → `tracking:global` when the captain covers no zones)
    //   • emitEtaUpdate(userId, payload)       → `user:{userId}` room
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

    /**
     * The captain's run this socket may follow, derived from the token and
     * the roster — never from anything the client sends.
     *
     * Live GPS is emitted per captain now, because a captain may cover
     * several zones and a zone room could not express that. The room a
     * socket joins is therefore `team:{captainId}`, and the captain is
     * resolved from the watcher's own PG: their stop for tonight names
     * their captain, and the standing roster answers when no stop exists
     * yet. A resident cannot ask to follow a different captain's bike any
     * more than they could previously ask for a different zone.
     *
     * Riders follow their own team. Super admins oversee the community, so
     * they join every captain's room.
     */
    const entitledTeamRooms = async () => {
      const dbm = require('../models');

      if (role === 'super_admin') {
        const captains = await dbm.CaptainZoneAssignment.findAll({
          attributes: ['captain_rider_id'],
          group: ['captain_rider_id'],
          raw: true,
        });
        return captains.map((c) => `team:${c.captain_rider_id}`);
      }

      if (role === 'rider') {
        const teamService = require('./deliveryTeamService');
        const team = await teamService.resolveTeam(accountId);
        return team.captain ? [`team:${team.captain.id}`] : [];
      }

      // Members and zone admins follow whoever is delivering to their PG.
      const user = await dbm.User.findByPk(effectiveUserId, { attributes: ['location_id'] });
      if (!user?.location_id) return [];

      const poll = await dbm.Poll.findOne({
        where: { date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) },
        attributes: ['id'],
      });
      if (poll) {
        const stop = await dbm.DeliveryStop.findOne({
          where: { poll_id: poll.id, location_id: user.location_id },
          attributes: ['rider_id'],
        });
        if (stop?.rider_id) return [`team:${stop.rider_id}`];
      }

      // No stop yet tonight — fall back to the standing roster so the map
      // is live from the moment the captain starts, not from the moment
      // someone re-runs assign.
      const teamService = require('./deliveryTeamService');
      const captain = await teamService.captainForLocation(user.location_id);
      return captain ? [`team:${captain.id}`] : [];
    };

    socket.on('subscribe_tracking', async ({ zone_id } = {}) => {
      try {
        const rooms = await entitledTeamRooms();
        for (const room of rooms) {
          socket.join(room);
          logger.info(`[socket] ${effectiveUserId} joined ${room}`);
        }

        // The zone room is kept alongside it. Nothing emits rider GPS
        // there any more, but it remains the channel for anything
        // genuinely zone-shaped, and joining it is still entitlement-
        // checked rather than taken from the client.
        const zoneId = await entitledZoneId(zone_id);
        if (zoneId) joinZoneRoom(zoneId);

        if (rooms.length === 0 && !zoneId) {
          // Nothing resolvable — a member whose location has not been set.
          // The global room carries only positions from a captain with no
          // zones at all, so it leaks nothing scoped.
          socket.join('tracking:global');
        }
      } catch (err) {
        logger.warn(`[socket] subscribe_tracking failed: ${err.message}`);
      }
    });

    socket.on('unsubscribe_tracking', async ({ zone_id } = {}) => {
      try {
        socket.leave('tracking:global');
        // Leave every team room this socket is in. Derived the same way it
        // joined would re-run the roster lookup and could miss a room if
        // the roster changed mid-session, so we read the socket's actual
        // membership instead — leaving a room you are not in is a no-op,
        // staying subscribed to one you asked to leave is not.
        for (const room of socket.rooms) {
          if (typeof room === 'string' && room.startsWith('team:')) socket.leave(room);
        }
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
 * Broadcast a delivery team's position to the people that team is
 * delivering to, and to nobody else.
 *
 * Keyed on the captain because the captain is the run: their helper shares
 * it, and another captain's residents are in a different room entirely. A
 * zone room could not do this job once a captain could cover several zones
 * at once — the position would have gone to one of them and the rest would
 * have seen a frozen map.
 *
 * The event name stays `rider_position` so the client's handler is
 * unchanged; what moved is who receives it.
 */
const emitTeamPosition = (captainId, payload) => {
  if (!io) return;
  const room = captainId ? `team:${captainId}` : 'tracking:global';
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
  emitTeamPosition,
  emitEtaUpdate,
  emitStopDelivered,
  emitStopReopened,
};
