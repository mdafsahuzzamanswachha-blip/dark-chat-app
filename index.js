const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

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

    // Join a specific chat room
    socket.on('join_room', (roomName) => {
        socket.join(roomName);
        console.log(`User ${socket.id} joined room: ${roomName}`);
    });

    // Listen for text chat messages and send ONLY to that room
    socket.on('send_message', (data) => {
        // data looks like: { room: 'room123', message: 'hello' }
        socket.to(data.room).emit('receive_message', data.message);
    });

    // Listen for shared files and relay them ONLY to that room
    socket.on('send_file', (data) => {
        // data looks like: { room: 'room123', fileData: 'base64...', fileName: 'img.png', fileType: 'image/png' }
        socket.to(data.room).emit('receive_file', {
            fileData: data.fileData,
            fileName: data.fileName,
            fileType: data.fileType
        });
    });

    // Listen for typing events inside a specific room
    socket.on('typing', (data) => {
        // data looks like: { room: 'room123', isTyping: true }
        socket.to(data.room).emit('user_typing', data.isTyping);
    });

    // WebRTC Calling - Target specifically within the room context
    socket.on('call_user', (data) => {
        socket.to(data.room).emit('incoming_call', {
            signal: data.signal,
            from: socket.id,
            isVideo: data.isVideo
        });
    });

    socket.on('answer_call', (data) => {
        socket.to(data.room).emit('call_accepted', data.signal);
    });
    
    socket.on('hangup', (data) => {
        socket.to(data.room).emit('call_ended');
    });
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
