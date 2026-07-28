const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const ROOM = 'chat-room';

function displayName(socket){
  return 'User-' + socket.id.slice(0, 4);
}

// Relays an event from one socket to the rest of the room, optionally
// reshaping the payload first.
function relay(socket, incoming, outgoing, transform){
  socket.on(incoming, (data) => {
    socket.to(ROOM).emit(outgoing, transform ? transform(data || {}, socket) : data);
  });
}

function createChatServer(){
  const app = express();
  app.use(cors());

  app.get('/', (req, res) => {
    res.send('Instant Chat Server is Running perfectly!');
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  let onlineUsers = 0;

  io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);

    socket.join(ROOM);
    io.to(ROOM).emit('user_count_update', onlineUsers);

    relay(socket, 'send_message', 'receive_message', (data, s) => ({
      from: s.id,
      fromName: data.fromName || displayName(s),
      text: data.text || '',
      attachment: data.attachment || null,
      ts: data.ts || Date.now()
    }));
    relay(socket, 'typing', 'user_typing');
    relay(socket, 'send_game', 'receive_game');
    relay(socket, 'call_user', 'incoming_call', (data, s) => ({
      signal: data.signal,
      callerName: displayName(s),
      isVideo: data.isVideo
    }));
    relay(socket, 'answer_call', 'call_accepted', (data) => data.signal);
    relay(socket, 'decline_call', 'call_declined');

    socket.on('hangup', () => io.to(ROOM).emit('call_ended'));

    socket.on('disconnect', () => {
      onlineUsers = Math.max(0, onlineUsers - 1);
      console.log(`User Disconnected: ${socket.id} (Total: ${onlineUsers})`);
      io.to(ROOM).emit('user_count_update', onlineUsers);
    });
  });

  return { app, server, io };
}

function startChatServer(port = process.env.PORT || 3000){
  const { server } = createChatServer();
  server.listen(port, () => console.log(`Server running on port ${port}`));
  return server;
}

module.exports = { ROOM, createChatServer, startChatServer };
