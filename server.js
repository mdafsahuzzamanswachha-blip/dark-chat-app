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

// Optional shared access token. When set, clients must connect with
// io(url, { auth: { token: '...' } }) using the same value.
const ACCESS_TOKEN = process.env.CHAT_ACCESS_TOKEN || '';
const ROOM = 'chat-room';
const MAX_TEXT_LENGTH = 4000;
const MAX_NAME_LENGTH = 40;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
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
    cors: corsOptions,
    maxHttpBufferSize: MAX_ATTACHMENT_BYTES + 64 * 1024
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
    if (!attachment || typeof attachment !== 'object') return null;
    const { name, type, data } = attachment;
    if (typeof type !== 'string' || !ALLOWED_ATTACHMENT_TYPES.includes(type)) return null;
    if (typeof data !== 'string') return null;
    // Only inline base64 data URLs matching the declared image type are relayed;
    // this blocks javascript:/http: payloads from reaching the peer's DOM.
    const expectedPrefix = `data:${type};base64,`;
    if (!data.startsWith(expectedPrefix)) return null;
    const payload = data.slice(expectedPrefix.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
    if (data.length > MAX_ATTACHMENT_BYTES) return null;
    return {
        name: sanitizeText(name, MAX_NAME_LENGTH) || 'attachment',
        type,
        data
    };
}

function sanitizeTimestamp(ts) {
    return Number.isFinite(ts) ? ts : Date.now();
}

function byteSize(value) {
    return Buffer.byteLength(JSON.stringify(value === undefined ? null : value));
}

let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected (Total: ${onlineUsers})`);

    let eventCount = 0;
    let windowStart = Date.now();

    function rateLimited() {
        const now = Date.now();
        if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
            windowStart = now;
            eventCount = 0;
        }
        eventCount++;
        return eventCount > RATE_LIMIT_EVENTS;
    }

    // ১v১ চ্যাটের জন্য সবাইকে ফিক্সড 'chat-room'-এ জয়েন করানো হচ্ছে
    socket.join(ROOM);

    // ইউজার কাউন্ট পাঠানো
    io.to(ROOM).emit('user_count_update', onlineUsers);

    // মেসেজ পাওয়ার পর রুমের অন্য সবাইকে পাঠানো
    socket.on('send_message', (data) => {
        if (rateLimited() || !data || typeof data !== 'object') return;
        const text = sanitizeText(data.text, MAX_TEXT_LENGTH);
        const attachment = sanitizeAttachment(data.attachment);
        if (!text && !attachment) return;
        socket.to(ROOM).emit('receive_message', {
            from: socket.id,
            fromName: sanitizeText(data.fromName, MAX_NAME_LENGTH) || ('User-' + socket.id.slice(0, 4)),
            text,
            attachment,
            ts: sanitizeTimestamp(data.ts)
        });
    });

    // টাইপিং স্ট্যাটাস
    socket.on('typing', (isTyping) => {
        if (rateLimited()) return;
        socket.to(ROOM).emit('user_typing', Boolean(isTyping));
    });

    // ভিডিও কল সিগন্যালিং
    socket.on('call_user', (data) => {
        if (rateLimited() || !data || typeof data !== 'object') return;
        if (byteSize(data.signal) > MAX_SIGNAL_BYTES) return;
        socket.to(ROOM).emit('incoming_call', {
            signal: data.signal,
            callerName: 'User-' + socket.id.slice(0, 4),
            isVideo: Boolean(data.isVideo)
        });
    });

    socket.on('answer_call', (data) => {
        if (rateLimited() || !data || typeof data !== 'object') return;
        if (byteSize(data.signal) > MAX_SIGNAL_BYTES) return;
        socket.to(ROOM).emit('call_accepted', data.signal);
    });

    socket.on('decline_call', () => {
        if (rateLimited()) return;
        socket.to(ROOM).emit('call_declined');
    });

    socket.on('hangup', () => {
        if (rateLimited()) return;
        io.to(ROOM).emit('call_ended');
    });

    // মাল্টিপ্লেয়ার গেম মুভ রিলে (Tic-Tac-Toe, Rock Paper Scissors)
    // ক্লায়েন্ট 'send_game' পাঠালে রুমের অন্যজনকে 'receive_game' হিসেবে পাঠানো হয়
    socket.on('send_game', (data) => {
        if (rateLimited() || !data || typeof data !== 'object') return;
        if (!GAME_EVENT_TYPES.includes(data.type)) return;
        socket.to(ROOM).emit('receive_game', {
            type: data.type,
            data: data.data && typeof data.data === 'object' ? data.data : {},
            ts: sanitizeTimestamp(data.ts)
        });
    });

    socket.on('disconnect', () => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`User Disconnected (Total: ${onlineUsers})`);
        io.to(ROOM).emit('user_count_update', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
