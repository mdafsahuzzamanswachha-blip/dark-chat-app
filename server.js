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

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);

    // ১v১ চ্যাটের জন্য সবাইকে ফিক্সড 'chat-room'-এ জয়েন করানো হচ্ছে
    socket.join('chat-room');
    
    // ইউজার কাউন্ট পাঠানো
    io.to('chat-room').emit('user_count_update', onlineUsers);

    // মেসেজ পাওয়ার পর রুমের অন্য সবাইকে পাঠানো
    socket.on('send_message', (data) => {
        const envelope = {
            from: socket.id,
            fromName: data.fromName || ('User-' + socket.id.slice(0, 4)),
            text: data.text || '',
            attachment: data.attachment || null,
            ts: data.ts || Date.now()
        };
        socket.to('chat-room').emit('receive_message', envelope);
    });

    // টাইপিং স্ট্যাটাস
    socket.on('typing', (isTyping) => {
        socket.to('chat-room').emit('user_typing', isTyping);
    });

    // ভিডিও কল সিগন্যালিং
    socket.on('call_user', (data) => {
        socket.to('chat-room').emit('incoming_call', {
            signal: data.signal,
            callerName: 'User-' + socket.id.slice(0, 4),
            isVideo: data.isVideo
        });
    });

    socket.on('answer_call', (data) => {
        socket.to('chat-room').emit('call_accepted', data.signal);
    });

    socket.on('decline_call', () => {
        socket.to('chat-room').emit('call_declined');
    });

    socket.on('hangup', () => {
        io.to('chat-room').emit('call_ended');
    });

    socket.on('disconnect', () => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`User Disconnected: ${socket.id} (Total: ${onlineUsers})`);
        io.to('chat-room').emit('user_count_update', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
