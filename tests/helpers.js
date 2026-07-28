const ioClient = require('socket.io-client');

function startServer(createChatServer) {
    const ctx = createChatServer();
    return new Promise((resolve) => {
        ctx.server.listen(0, () => {
            resolve({ ...ctx, port: ctx.server.address().port });
        });
    });
}

function stopServer(ctx) {
    return new Promise((resolve) => {
        ctx.io.close(() => ctx.server.close(resolve));
    });
}

// Counts are recorded from socket creation so tests never race the broadcast
// the server sends while the connection is still being established.
function connectClient(port) {
    const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
    });
    socket.counts = [];
    socket.on('user_count_update', (count) => socket.counts.push(count));
    return new Promise((resolve, reject) => {
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });
}

function waitFor(predicate, description, timeout = 3000) {
    const deadline = Date.now() + timeout;
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (predicate()) return resolve();
            if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${description}`));
            setTimeout(poll, 20);
        };
        poll();
    });
}

async function waitForCounts(socket, n, timeout = 3000) {
    await waitFor(() => socket.counts.length >= n, `${n} user_count_update event(s)`, timeout);
    return socket.counts;
}

function once(socket, event, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeout);
        socket.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args.length > 1 ? args : args[0]);
        });
    });
}

function never(socket, event, ms = 300) {
    return new Promise((resolve, reject) => {
        const handler = () => reject(new Error(`Unexpectedly received "${event}"`));
        socket.once(event, handler);
        setTimeout(() => {
            socket.off(event, handler);
            resolve();
        }, ms);
    });
}

module.exports = { startServer, stopServer, connectClient, waitFor, waitForCounts, once, never };
