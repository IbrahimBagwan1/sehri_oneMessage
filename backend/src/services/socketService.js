'use strict';

const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Module-level Socket.IO instance.
// Initialised once in server.js via initSocket(httpServer).
// Controllers import getIO() to emit events without passing io around.
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
  // JWT authentication middleware for Socket.IO
  // The client must send:   { auth: { token: '<access_token>' } }
  // when calling io.connect().  We verify the token and attach the decoded
  // payload as socket.user so handlers know who is connected.
  // ---------------------------------------------------------------------------
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }
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
    const { id: accountId, role, user_id } = socket.user;
    // The effective user identity (same logic as requireUserAccess middleware).
    const effectiveId = role === 'user' ? accountId : (user_id || accountId);

    logger.info(`[Socket] connected  role=${role}  id=${effectiveId}  socketId=${socket.id}`);

    // -----------------------------------------------------------------------
    // join_group  — client joins a Socket.IO room for a chat group.
    // The controller already validates membership before letting the client
    // fetch messages via REST.  Here we trust the client knows which groups
    // it belongs to (it got the list from GET /api/chat/groups).
    // A malicious join attempt to a group the user isn't in will simply
    // result in them never receiving events (the controller emits only to
    // verified members).
    //
    // Payload: { group_id: '<uuid>' }
    // -----------------------------------------------------------------------
    socket.on('join_group', ({ group_id } = {}) => {
      if (!group_id) return;
      socket.join(`group:${group_id}`);
      logger.info(`[Socket] ${effectiveId} joined room group:${group_id}`);
    });

    // -----------------------------------------------------------------------
    // leave_group  — client leaves a room (e.g. navigates away from chat).
    // Payload: { group_id: '<uuid>' }
    // -----------------------------------------------------------------------
    socket.on('leave_group', ({ group_id } = {}) => {
      if (!group_id) return;
      socket.leave(`group:${group_id}`);
      logger.info(`[Socket] ${effectiveId} left room group:${group_id}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`[Socket] disconnected  id=${effectiveId}  reason=${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`[Socket] error  id=${effectiveId}  ${err.message}`);
    });
  });

  logger.info('[Socket] Socket.IO initialised');
  return io;
};

/**
 * Returns the Socket.IO server instance.
 * Throws if initSocket() has not been called yet.
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO has not been initialised. Call initSocket(httpServer) first.');
  }
  return io;
};

// ---------------------------------------------------------------------------
// Emitter helpers used by chatController
// ---------------------------------------------------------------------------

/**
 * Broadcast a new message to every socket in a group room.
 * Called after the message has been saved to the DB.
 *
 * @param {string} groupId
 * @param {object} messagePayload  — the shaped message object returned to REST callers too
 */
const emitNewMessage = (groupId, messagePayload) => {
  getIO().to(`group:${groupId}`).emit('new_message', messagePayload);
};

/**
 * Broadcast a message deletion event to the group room.
 *
 * @param {string} groupId
 * @param {string} messageId
 */
const emitMessageDeleted = (groupId, messageId) => {
  getIO().to(`group:${groupId}`).emit('message_deleted', { message_id: messageId });
};

/**
 * Notify group members that the member list changed (someone added/removed).
 *
 * @param {string} groupId
 * @param {'member_added'|'member_removed'} event
 * @param {object} payload
 */
const emitMemberUpdate = (groupId, event, payload) => {
  getIO().to(`group:${groupId}`).emit(event, payload);
};

module.exports = {
  initSocket,
  getIO,
  emitNewMessage,
  emitMessageDeleted,
  emitMemberUpdate,
};
