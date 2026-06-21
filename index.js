const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Dark Chat Server is running...');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Direct 1v1 text distribution 
    socket.on('send_message', (message) => {
        socket.broadcast.emit('receive_message', message);
    });

    // Simple 1v1 typing notification toggle
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user_typing', isTyping);
    });

    // WebRTC 1v1 Call Routing Events
    socket.on('call_user', (data) => {
        // Explicitly forwards the signaling track offer and video flag choice
        socket.broadcast.emit('incoming_call', {
            signal: data.signal,
            isVideo: data.isVideo
        });
    });

    socket.on('answer_call', (data) => {
        socket.broadcast.emit('call_accepted', data.signal);
    });
    
    socket.on('hangup', () => {
        socket.broadcast.emit('call_ended');
    });
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
