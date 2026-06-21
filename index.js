const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// A simple route just to verify the backend is up
app.get('/', (req, res) => {
    res.send('Dark Chat Server is running...');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // Allows any frontend client to connect for now
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Listen for text chat messages and broadcast them
    socket.on('send_message', (data) => {
        socket.broadcast.emit('receive_message', data);
    });

    // WebRTC Signaling Events for Audio/Video Calling
    socket.on('call_user', (data) => {
        // Forwards the call offer to the other user
        socket.broadcast.emit('incoming_call', {
            signal: data.signal,
            from: socket.id
        });
    });

    socket.on('answer_call', (data) => {
        // Forwards the call acceptance back to the caller
        socket.broadcast.emit('call_accepted', data.signal);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
