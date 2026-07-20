const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '/')));

const users = new Map();

io.on('connection', (socket) => {
  users.set(socket.id, { id: socket.id, name: 'User-' + socket.id.slice(0, 4) });
  
  // নতুন কেউ কানেক্ট হলে সবাইকে জানিয়ে দেওয়া
  io.emit('user_list', Array.from(users.values()));

  socket.on('set_username', ({ name }) => {
    users.set(socket.id, { id: socket.id, name });
    io.emit('user_list', Array.from(users.values()));
  });

  // মেসেজিং (সবাই পাবে)
  socket.on('send_message', (payload) => {
    const sender = users.get(socket.id) || {};
    const envelope = {
      from: socket.id,
      fromName: sender.name || ('User-' + socket.id.slice(0,4)),
      text: payload.text || '',
      attachment: payload.attachment || null,
      ts: payload.ts || Date.now()
    };
    
    // নিজের ছাড়া বাকি সবাইকে মেসেজ পাঠানো
    socket.broadcast.emit('broadcast_message', envelope);
  });

  socket.on('typing', (d) => {
    const sender = users.get(socket.id) || {};
    socket.broadcast.emit('typing', { name: sender.name, isTyping: d.isTyping });
  });

  // কল সিগন্যালিং
  socket.on('call_user', (data) => {
    const sender = users.get(socket.id) || {};
    socket.broadcast.emit('incoming_call', { 
      signal: data.signal, 
      from: socket.id, 
      callerName: sender.name, 
      isVideo: data.isVideo 
    });
  });

  socket.on('answer_call', (data) => {
    socket.broadcast.emit('call_answered', { signal: data.signal, from: socket.id });
  });

  socket.on('decline_call', () => {
    socket.broadcast.emit('call_declined', { from: socket.id });
  });

  socket.on('end_call', () => {
    socket.broadcast.emit('call_ended', { from: socket.id });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('user_list', Array.from(users.values()));
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
