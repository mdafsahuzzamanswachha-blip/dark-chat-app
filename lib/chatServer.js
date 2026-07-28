const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const ROOM = 'chat-room';

// Attachments are sent as data URLs inside the message payload; anything above
// this limit is rejected with an explicit error instead of Socket.IO silently
// killing the connection.
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;

function displayName(socket){
  return 'User-' + socket.id.slice(0, 4);
}

// Wraps a socket handler so a throwing/rejecting handler is logged and reported
// back to the sender instead of being swallowed by Socket.IO.
function onSocket(socket, event, handler){
  socket.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error(`Handler failed for '${event}' from ${socket.id}:`, err);
      socket.emit('server_error', { event, message: err.message || 'Unknown server error' });
    }
  });
}

// Relays an event from one socket to the rest of the room, optionally
// validating and reshaping the payload first.
function relay(socket, incoming, outgoing, transform){
  onSocket(socket, incoming, (data) => {
    socket.to(ROOM).emit(outgoing, transform ? transform(data, socket) : data);
  });
}

function requireSignal(event, data){
  if (!data || !data.signal) throw new Error(`${event} requires a signal`);
}

function createChatServer(){
  const app = express();
  app.use(cors());

  app.get('/', (req, res) => {
    res.send('Instant Chat Server is Running perfectly!');
  });

  // Express error handler: without this Express swallows handler errors into a
  // bare 500 with no log.
  app.use((err, req, res, next) => {
    console.error(`Request failed: ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: MAX_PAYLOAD_BYTES,
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  let onlineUsers = 0;

  io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);

    socket.on('error', (err) => {
      console.error(`Socket error (${socket.id}):`, err);
    });

    socket.join(ROOM);
    io.to(ROOM).emit('user_count_update', onlineUsers);

    relay(socket, 'send_message', 'receive_message', (data, s) => {
      if (!data || typeof data !== 'object') {
        throw new Error('send_message requires an object payload');
      }
      const envelope = {
        from: s.id,
        fromName: data.fromName || displayName(s),
        text: data.text || '',
        attachment: data.attachment || null,
        ts: data.ts || Date.now()
      };
      if (!envelope.text && !envelope.attachment) {
        throw new Error('send_message requires text or an attachment');
      }
      return envelope;
    });

    relay(socket, 'typing', 'user_typing', (isTyping) => Boolean(isTyping));

    relay(socket, 'send_game', 'receive_game', (data) => {
      if (!data || typeof data.type !== 'string') {
        throw new Error('send_game requires a payload with a type');
      }
      return data;
    });

    relay(socket, 'call_user', 'incoming_call', (data, s) => {
      requireSignal('call_user', data);
      return { signal: data.signal, callerName: displayName(s), isVideo: data.isVideo };
    });

    relay(socket, 'answer_call', 'call_accepted', (data) => {
      requireSignal('answer_call', data);
      return data.signal;
    });

    relay(socket, 'decline_call', 'call_declined');

    onSocket(socket, 'hangup', () => io.to(ROOM).emit('call_ended'));

    socket.on('disconnect', (reason) => {
      onlineUsers = Math.max(0, onlineUsers - 1);
      console.log(`User Disconnected: ${socket.id} (${reason}) (Total: ${onlineUsers})`);
      io.to(ROOM).emit('user_count_update', onlineUsers);
    });
  });

  // Rejected handshakes (bad origin, oversized payload, transport errors) are
  // otherwise invisible on the server side.
  io.engine.on('connection_error', (err) => {
    console.error(`Socket.IO connection error (${err.code}): ${err.message}`);
  });

  return { app, server, io };
}

function startChatServer(port = process.env.PORT || 3000){
  const { server } = createChatServer();

  server.on('error', (err) => {
    console.error(`HTTP server error on port ${port}:`, err);
    process.exit(1);
  });
  server.listen(port, () => console.log(`Server running on port ${port}`));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception, shutting down:', err);
    server.close(() => process.exit(1));
  });

  return server;
}

module.exports = { ROOM, MAX_PAYLOAD_BYTES, createChatServer, startChatServer };
