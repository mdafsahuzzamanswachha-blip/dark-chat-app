const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Comma separated list of allowed browser origins
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
const originAllowlist = allowedOrigins.length ? allowedOrigins : DEFAULT_ORIGINS;

function originChecker(origin, callback) {
    if (!origin || originAllowlist.includes(origin)) return callback(null, true);
    return callback(null, false);
}

const corsOptions = { origin: originChecker, methods: ['GET', 'POST'], credentials: false };
app.use(cors(corsOptions));
app.disable('x-powered-by');

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send('Instant Chat Server is Running perfectly!');
});

app.use((err, req, res, next) => {
    console.error(`Request failed: ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
});

const ACCESS_TOKEN = process.env.CHAT_ACCESS_TOKEN || '';
const ROOM = 'chat-room';
const MAX_TEXT_LENGTH = 4000;
const MAX_NAME_LENGTH = 40;
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

    socket.join(ROOM);
    io.to(ROOM).emit('user_count_update', onlineUsers);

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

    onSocket(socket, 'typing', (isTyping) => {
        assertNotRateLimited();
        socket.to(ROOM).emit('user_typing', Boolean(isTyping));
    });

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = { ROOM, server, app };
