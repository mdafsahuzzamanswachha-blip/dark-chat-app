const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Comma separated list of allowed browser origins, e.g.
// ALLOWED_ORIGINS="https://dark-chat.example.com,http://localhost:5500"
// Falls back to local development origins when unset.
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
const originAllowlist = allowedOrigins.length ? allowedOrigins : DEFAULT_ORIGINS;

function originChecker(origin, callback) {
    // Non-browser clients (curl, health checks) send no Origin header.
    if (!origin || originAllowlist.includes(origin)) return callback(null, true);
    // Reject by omitting CORS headers rather than throwing, so no stack trace leaks.
    return callback(null, false);
}

const corsOptions = { origin: originChecker, methods: ['GET', 'POST'], credentials: false };
app.use(cors(corsOptions));
app.disable('x-powered-by');

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

// Optional shared access token. When set, clients must connect with
// io(url, { auth: { token: '...' } }) using the same value.
const ACCESS_TOKEN = process.env.CHAT_ACCESS_TOKEN || '';
const ROOM = 'chat-room';
const MAX_TEXT_LENGTH = 4000;
const MAX_NAME_LENGTH = 40;
// Attachments are sent as data URLs inside the message payload; anything above
// this limit is rejected with an explicit error instead of Socket.IO silently
// killing the connection.
const MAX_ATTACHMENT_BYTES = 11 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;
const MAX_SIGNAL_BYTES = 128 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain'
];
const RATE_LIMIT_EVENTS = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 1000;
const GAME_EVENT_TYPES = ['ttt_move', 'ttt_reset', 'rps_choice', 'rps_reset'];

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: MAX_PAYLOAD_BYTES,
    cors: corsOptions
});

io.use((socket, next) => {
    if (!ACCESS_TOKEN) return next();
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (typeof token === 'string' && token === ACCESS_TOKEN) return next();
    return next(new Error('unauthorized'));
});

function sanitizeText(value, maxLength) {
    if (typeof value !== 'string') return '';
    // Strip control characters that can be used to spoof rendered output.
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function sanitizeAttachment(attachment) {
    if (attachment === null || attachment === undefined) return null;
    if (typeof attachment !== 'object') {
        throw new Error('attachment must be an object');
    }
    const { name, type, data } = attachment;
    if (typeof type !== 'string' || !ALLOWED_ATTACHMENT_TYPES.includes(type)) {
        throw new Error(`attachment type must be one of: ${ALLOWED_ATTACHMENT_TYPES.join(', ')}`);
    }
    if (typeof data !== 'string') {
        throw new Error('attachment data must be a data URL string');
    }
    // Only inline base64 data URLs matching the declared type are relayed; this
    // blocks javascript:/data:text/html payloads from reaching the peer's DOM.
    const expectedPrefix = `data:${type};base64,`;
    if (!data.startsWith(expectedPrefix) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(expectedPrefix.length))) {
        throw new Error(`attachment data must be a base64 ${type} data URL`);
    }
    if (data.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`attachment is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB encoded)`);
    }
    return {
        name: sanitizeText(name, MAX_NAME_LENGTH) || 'attachment',
        type,
        data
    };
}

function sanitizeTimestamp(ts) {
    return Number.isFinite(ts) ? ts : Date.now();
}

function assertSignalSize(signal) {
    if (Buffer.byteLength(JSON.stringify(signal === undefined ? null : signal)) > MAX_SIGNAL_BYTES) {
        throw new Error('signal payload is too large');
    }
}

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
    console.log(`User Connected (Total: ${onlineUsers})`);

    let eventCount = 0;
    let windowStart = Date.now();

    function assertNotRateLimited() {
        const now = Date.now();
        if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
            windowStart = now;
            eventCount = 0;
        }
        eventCount++;
        if (eventCount > RATE_LIMIT_EVENTS) {
            throw new Error('too many events, slow down');
        }
    }

    // ১v১ চ্যাটের জন্য সবাইকে ফিক্সড 'chat-room'-এ জয়েন করানো হচ্ছে
    socket.join(ROOM);

    socket.on('error', (err) => {
        console.error(`Socket error (${socket.id}):`, err);
    });

    // ইউজার কাউন্ট পাঠানো
    io.to(ROOM).emit('user_count_update', onlineUsers);

    // মেসেজ পাওয়ার পর রুমের অন্য সবাইকে পাঠানো
    onSocket(socket, 'send_message', (data) => {
        assertNotRateLimited();
        if (!data || typeof data !== 'object') {
            throw new Error('send_message requires an object payload');
        }
        const envelope = {
            from: socket.id,
            fromName: sanitizeText(data.fromName, MAX_NAME_LENGTH) || ('User-' + socket.id.slice(0, 4)),
            text: sanitizeText(data.text, MAX_TEXT_LENGTH),
            attachment: sanitizeAttachment(data.attachment),
            ts: sanitizeTimestamp(data.ts)
        };
        if (!envelope.text && !envelope.attachment) {
            throw new Error('send_message requires text or an attachment');
        }
        socket.to(ROOM).emit('receive_message', envelope);
    });

    // টাইপিং স্ট্যাটাস
    onSocket(socket, 'typing', (isTyping) => {
        assertNotRateLimited();
        socket.to(ROOM).emit('user_typing', Boolean(isTyping));
    });

    // ভিডিও কল সিগন্যালিং
    onSocket(socket, 'call_user', (data) => {
        assertNotRateLimited();
        if (!data || !data.signal) {
            throw new Error('call_user requires a signal');
        }
        assertSignalSize(data.signal);
        socket.to(ROOM).emit('incoming_call', {
            signal: data.signal,
            callerName: 'User-' + socket.id.slice(0, 4),
            isVideo: Boolean(data.isVideo)
        });
    });

    onSocket(socket, 'answer_call', (data) => {
        assertNotRateLimited();
        if (!data || !data.signal) {
            throw new Error('answer_call requires a signal');
        }
        assertSignalSize(data.signal);
        socket.to(ROOM).emit('call_accepted', data.signal);
    });

    onSocket(socket, 'decline_call', () => {
        assertNotRateLimited();
        socket.to(ROOM).emit('call_declined');
    });

    onSocket(socket, 'hangup', () => {
        assertNotRateLimited();
        io.to(ROOM).emit('call_ended');
    });

    // মাল্টিপ্লেয়ার গেম মুভ রিলে (Tic-Tac-Toe, Rock Paper Scissors)
    // ক্লায়েন্ট 'send_game' পাঠালে রুমের অন্যজনকে 'receive_game' হিসেবে পাঠানো হয়
    onSocket(socket, 'send_game', (data) => {
        assertNotRateLimited();
        if (!data || !GAME_EVENT_TYPES.includes(data.type)) {
            throw new Error(`send_game type must be one of: ${GAME_EVENT_TYPES.join(', ')}`);
        }
        socket.to(ROOM).emit('receive_game', {
            type: data.type,
            data: data.data && typeof data.data === 'object' ? data.data : {},
            ts: sanitizeTimestamp(data.ts)
        });
    });

    socket.on('disconnect', (reason) => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`User Disconnected (${reason}) (Total: ${onlineUsers})`);
        io.to(ROOM).emit('user_count_update', onlineUsers);
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
