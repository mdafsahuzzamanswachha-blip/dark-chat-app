const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Dark Chat Server is running with Database...');
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Connect to MongoDB using Render environment variable
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
.then(() => console.log("MongoDB Connected Successfully"))
.catch(err => console.error("MongoDB Connection Error:", err));

// Message Schema to define database structure
const MessageSchema = new mongoose.Schema({
    sender: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. Fetch and load past chat history on user connection
    try {
        const history = await Message.find().sort({ timestamp: 1 }).limit(100);
        socket.emit('chat_history', history);
    } catch (err) {
        console.error("Error loading history:", err);
    }

    // 2. Direct 1v1 text distribution and database saving
    socket.on('send_message', async (message) => {
        try {
            const newMessage = new Message({ sender: socket.id, text: message });
            await newMessage.save();
            
            socket.broadcast.emit('receive_message', message);
        } catch (err) {
            console.error("Error saving message:", err);
        }
    });

    // Simple 1v1 typing notification toggle
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user_typing', isTyping);
    });

    // WebRTC 1v1 Call Routing Events
    socket.on('call_user', (data) => {
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
