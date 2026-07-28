const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const ROOM = 'chat-room';
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024; // 12 MB Limit

function createApp() {
    const app = express();
    app.use(cors());

    // Health Check Endpoint
    app.get('/', (req, res) => {
        res.send('Instant Chat Server is Running perfectly!');
    });

    // Express error handler
    app.use((err, req, res, next) => {
        console.error(`Request failed: ${req.method} ${req.originalUrl}`, err);
        if (res.headersSent) return next(err);
        res.status(500).json({ error: 'Internal server error' });
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

// Wraps a socket handler to log errors and inform sender
function onSocket(socket, event, handler) {
    socket.on(event, async (...args) => {
        try {
            await handler(...args);
        } catch (err) {
            console.error(`Handler failed for '${event}' from ${socket.id}:`, err);
            socket.emit('server_error', { event, message: err.message || 'Unknown server error' });
        }
    });
}

function registerSocketHandlers(io) {
    let onlineUsers = 0;

    io.on('connection', (socket) => {
        onlineUsers++;
        console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);
        
        socket.join(ROOM);

        socket.on('error', (err) => {
            console.error(`Socket error (${socket.id}):`, err);
        });

        socket.conn.on('close', (reason, description) => {
            if (description) {
                console.error(`Transport closed for ${socket.id} (${reason}):`, description.message || description);
            }
        });

        // ইউজার কাউন্ট পাঠানো
        io.to(ROOM).emit('user_count_update', onlineUsers);

        // মেসেজ পাঠানো
        onSocket(socket, 'send_message', (data) => {
            if (!data || typeof data !== 'object') {
                throw new Error('send_message requires an object payload');
            }
            const envelope = buildEnvelope(socket.id, data);
            if (!envelope.text && !envelope.attachment) {
                throw new Error('send_message requires text or an attachment');
            }
            socket.to(ROOM).emit('receive_message', envelope);
        });

        // টাইপিং স্ট্যাটাস
        onSocket(socket, 'typing', (isTyping) => {
            socket.to(ROOM).emit('user_typing', Boolean(isTyping));
        });

        // ভিডিও কল সিগন্যালিং
        onSocket(socket, 'call_user', (data = {}) => {
            if (!data || !data.signal) {
                throw new Error('call_user requires a signal');
            }
            socket.to(ROOM).emit('incoming_call', {
                signal: data.signal,
                callerName: 'User-' + socket.id.slice(0, 4),
                isVideo: data.isVideo
            });
        });

        onSocket(socket, 'answer_call', (data = {}) => {
            if (!data || !data.signal) {
                throw new Error('answer_call requires a signal');
            }
            socket.to(ROOM).emit('call_accepted', data.signal);
        });

        onSocket(socket, 'decline_call', () => {
            socket.to(ROOM).emit('call_declined');
        });

        onSocket(socket, 'hangup', () => {
            io.to(ROOM).emit('call_ended');
        });

        // মাল্টিপ্লেয়ার গেম মুভ রিলে
        onSocket(socket, 'send_game', (data) => {
            if (!data || typeof data.type !== 'string') {
                throw new Error('send_game requires a payload with a type');
            }
            socket.to(ROOM).emit('receive_game', data);
        });

        socket.on('disconnect', (reason) => {
            onlineUsers = Math.max(0, onlineUsers - 1);
            console.log(`User Disconnected: ${socket.id} (${reason}) (Total: ${onlineUsers})`);
            io.to(ROOM).emit('user_count_update', onlineUsers);
        });
    });

    return () => onlineUsers;
}

function createChatServer() {
    const app = createApp();
    const server = http.createServer(app);
    const io = new Server(server, {
        maxHttpBufferSize: MAX_PAYLOAD_BYTES,
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.engine.on('connection_error', (err) => {
        console.error(`Socket.IO connection error (${err.code}): ${err.message}`);
    });

    const getOnlineUsers = registerSocketHandlers(io);
    return { app, server, io, getOnlineUsers };
}

if (require.main === module) {
    const { server } = createChatServer();
    const PORT = process.env.PORT || 3000;

    server.on('error', (err) => {
        console.error(`HTTP server error on port ${PORT}:`, err);
        process.exit(1);
    });

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled promise rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
        console.error('Uncaught exception, shutting down:', err);
        server.close(() => process.exit(1));
    });
}

module.exports = { ROOM, createApp, buildEnvelope, registerSocketHandlers, createChatServer };