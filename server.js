const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const ROOM = 'chat-room';

function createApp() {
    const app = express();
    app.use(cors());
    // Health Check Endpoint
    app.get('/', (req, res) => {
        res.send('Instant Chat Server is Running perfectly!');
    });
    return app;
}

function buildEnvelope(socketId, data = {}) {
    return {
        from: socketId,
        fromName: data.fromName || ('User-' + socketId.slice(0, 4)),
        text: data.text || '',
        attachment: data.attachment || null,
        ts: data.ts || Date.now()
    };
}

function registerSocketHandlers(io) {
    let onlineUsers = 0;

    io.on('connection', (socket) => {
        onlineUsers++;
        console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);
        // ১v১ চ্যাটের জন্য সবাইকে ফিক্সড 'chat-room'-এ জয়েন করানো হচ্ছে
        socket.join(ROOM);

        // ইউজার কাউন্ট পাঠানো
        io.to(ROOM).emit('user_count_update', onlineUsers);

        // মেসেজ পাওয়ার পর রুমের অন্য সবাইকে পাঠানো
        socket.on('send_message', (data) => {
            socket.to(ROOM).emit('receive_message', buildEnvelope(socket.id, data));
        });

        // টাইপিং স্ট্যাটাস
        socket.on('typing', (isTyping) => {
            socket.to(ROOM).emit('user_typing', isTyping);
        });

        // ভিডিও কল সিগন্যালিং
        socket.on('call_user', (data = {}) => {
            socket.to(ROOM).emit('incoming_call', {
                signal: data.signal,
                callerName: 'User-' + socket.id.slice(0, 4),
                isVideo: data.isVideo
            });
        });

        socket.on('answer_call', (data = {}) => {
            socket.to(ROOM).emit('call_accepted', data.signal);
        });

        socket.on('decline_call', () => {
            socket.to(ROOM).emit('call_declined');
        });

        socket.on('hangup', () => {
            io.to(ROOM).emit('call_ended');
        });

        // মাল্টিপ্লেয়ার গেম মুভ রিলে (Tic-Tac-Toe, Rock Paper Scissors)
        // ক্লায়েন্ট 'send_game' পাঠালে রুমের অন্যজনকে 'receive_game' হিসেবে পাঠানো হয়
        socket.on('send_game', (data) => {
            socket.to(ROOM).emit('receive_game', data);
        });

        socket.on('disconnect', () => {
            onlineUsers = Math.max(0, onlineUsers - 1);
            console.log(`User Disconnected: ${socket.id} (Total: ${onlineUsers})`);
            io.to(ROOM).emit('user_count_update', onlineUsers);
        });
    });

    return () => onlineUsers;
}

function createChatServer() {
    const app = createApp();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });
    const getOnlineUsers = registerSocketHandlers(io);
    return { app, server, io, getOnlineUsers };
}

if (require.main === module) {
    const { server } = createChatServer();
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = { ROOM, createApp, buildEnvelope, registerSocketHandlers, createChatServer };
