const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health Check Endpoint (Render server ke jagay rakhar jonno)
app.get('/', (req, res) => {
    res.send('Instant Chat Server is Running perfectly without DB!');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // Pura prithibi theke access thakbe
        methods: ["GET", "POST"]
    }
});

// Real-time communication socket connection
io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // Message paile sathe sathe database chara instant arekjon ke bhejbe
    socket.on('send_message', (data) => {
        socket.broadcast.emit('receive_message', data);
    });

    // Typing feature tracking
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user_typing', isTyping);
    });

    // Call logic
    socket.on('call_user', (data) => {
        socket.broadcast.emit('incoming_call', { signal: data.signal, isVideo: data.isVideo });
    });

    socket.on('answer_call', (data) => {
        socket.broadcast.emit('call_accepted', data.signal);
    });

    socket.on('hangup', () => {
        socket.broadcast.emit('call_ended');
    });

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
