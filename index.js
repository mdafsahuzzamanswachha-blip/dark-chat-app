const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health Check Endpoint (Render server কে জাগিয়ে রাখার জন্য)
app.get('/', (req, res) => {
    res.send('Instant Chat Server is Running perfectly without DB!');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // পুরো পৃথিবী থেকে অ্যাক্সেস থাকবে
        methods: ["GET", "POST"]
    }
});

// অনলাইনে কয়জন আছে তা ট্র্যাক করার ভ্যারিয়েবল
let onlineUsers = 0;

// Real-time communication socket connection
io.on('connection', (socket) => {
    onlineUsers++;
    console.log(`User Connected: ${socket.id} (Total: ${onlineUsers})`);

    // ১v১ চ্যাটের সুরক্ষার জন্য সবাইকে একটি ফিক্সড রুমে জয়েন করানো হচ্ছে
    socket.join('chat-room');
    
    // কেউ কানেক্ট হলেই রুমে থাকা সবাইকে ইউজার কাউন্ট আপডেট পাঠানো
    io.to('chat-room').emit('user_count_update', onlineUsers);

    // মেসেজ পাইলে ডাটাবেজ ছাড়া ইনস্ট্যান্ট অন্যজনকে রুমে পাঠানো হবে
    socket.on('send_message', (data) => {
        socket.to('chat-room').emit('receive_message', data);
    });

    // Typing feature tracking (রুমের অন্য ইউজারের কাছে পাঠানো)
    socket.on('typing', (isTyping) => {
        socket.to('chat-room').emit('user_typing', isTyping);
    });

    // Call logic (নিরাপদভাবে রুমের মাধ্যমে অন্যজনকে সিগন্যাল পাঠানো)
    socket.on('call_user', (data) => {
        socket.to('chat-room').emit('incoming_call', { signal: data.signal, isVideo: data.isVideo });
    });

    socket.on('answer_call', (data) => {
        socket.to('chat-room').emit('call_accepted', data.signal);
    });

    socket.on('hangup', () => {
        io.to('chat-room').emit('call_ended');
    });

    socket.on('disconnect', () => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        console.log(`User Disconnected: ${socket.id} (Total: ${onlineUsers})`);
        
        // কেউ ডিসকানেক্ট হলে ইউজার কাউন্ট আপডেট রুমে পাঠানো
        io.to('chat-room').emit('user_count_update', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
