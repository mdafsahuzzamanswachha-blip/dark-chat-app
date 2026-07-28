const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const app = express();
app.use(cors());
// Health Check Endpoint
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
// Attachments are sent as data URLs inside the message payload; anything above
// this limit is rejected with an explicit error instead of Socket.IO silently
// killing the connection.
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;
const io = new Server(server, {
    maxHttpBufferSize: MAX_PAYLOAD_BYTES,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
let onlineUsers = 0;

// Wraps a socket handler so a throwing/rejecting handler is logged and reported
// back to the sender instead of being swallowed by Socket.IO.
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

io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);
    // ১v১ চ্যাটের জন্য সবাইকে ফিক্সড 'chat-room'-এ জয়েন করানো হচ্ছে
    socket.join('chat-room');

    socket.on('error', (err) => {
        console.error(`Socket error (${socket.id}):`, err);
    });
    // The cause of a transport-level failure (notably 'Max payload size
    // exceeded' for a payload above maxHttpBufferSize) is only carried here;
    // the 'disconnect' event just reports an unexplained 'transport error'.
    socket.conn.on('close', (reason, description) => {
        if (description) {
            console.error(`Transport closed for ${socket.id} (${reason}):`, description.message || description);
        }
    });

    // ইউজার কাউন্ট পাঠানো
    io.to('chat-room').emit('user_count_update', onlineUsers);
    // মেসেজ পাওয়ার পর রুমের অন্য সবাইকে পাঠানো
    onSocket(socket, 'send_message', (data) => {
        if (!data || typeof data !== 'object') {
            throw new Error('send_message requires an object payload');
        }
        const envelope = {
            from: socket.id,
            fromName: data.fromName || ('User-' + socket.id.slice(0, 4)),
            text: data.text || '',
            attachment: data.attachment || null,
            ts: data.ts || Date.now()
        };
        if (!envelope.text && !envelope.attachment) {
            throw new Error('send_message requires text or an attachment');
        }
        socket.to('chat-room').emit('receive_message', envelope);
    });
    // টাইপিং স্ট্যাটাস
    onSocket(socket, 'typing', (isTyping) => {
        socket.to('chat-room').emit('user_typing', Boolean(isTyping));
    });
    // ভিডিও কল সিগন্যালিং
    onSocket(socket, 'call_user', (data) => {
        if (!data || !data.signal) {
            throw new Error('call_user requires a signal');
        }
        socket.to('chat-room').emit('incoming_call', {
            signal: data.signal,
            callerName: 'User-' + socket.id.slice(0, 4),
            isVideo: data.isVideo
        });
    });
    onSocket(socket, 'answer_call', (data) => {
        if (!data || !data.signal) {
            throw new Error('answer_call requires a signal');
        }
        socket.to('chat-room').emit('call_accepted', data.signal);
    });
    onSocket(socket, 'decline_call', () => {
        socket.to('chat-room').emit('call_declined');
    });
    onSocket(socket, 'hangup', () => {
        io.to('chat-room').emit('call_ended');
    });
    // মাল্টিপ্লেয়ার গেম মুভ রিলে (Tic-Tac-Toe, Rock Paper Scissors)
    // ক্লায়েন্ট 'send_game' পাঠালে রুমের অন্যজনকে 'receive_game' হিসেবে পাঠানো হয়
    onSocket(socket, 'send_game', (data) => {
        if (!data || typeof data.type !== 'string') {
            throw new Error('send_game requires a payload with a type');
        }
        socket.to('chat-room').emit('receive_game', data);
    });
    socket.on('disconnect', (reason) => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`User Disconnected: ${socket.id} (${reason}) (Total: ${onlineUsers})`);
        io.to('chat-room').emit('user_count_update', onlineUsers);
    });
});

// Rejected handshakes (bad origin, oversized payload, transport errors) are
// otherwise invisible on the server side.
io.engine.on('connection_error', (err) => {
    console.error(`Socket.IO connection error (${err.code}): ${err.message}`);
});

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
