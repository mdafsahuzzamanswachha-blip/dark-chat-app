const request = require('supertest');
const { createApp, createChatServer, ROOM } = require('../index');
const { startServer, stopServer, connectClient, waitFor, waitForCounts, once, never } = require('./helpers');

describe('index.js health endpoint', () => {
    it('responds to GET / with the running message', async () => {
        const res = await request(createApp()).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Instant Chat Server is Running perfectly without DB!');
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });
});

describe('index.js socket handlers', () => {
    let ctx;
    let clients;

    beforeEach(async () => {
        ctx = await startServer(createChatServer);
        clients = [];
    });

    afterEach(async () => {
        clients.forEach((c) => c.close());
        await stopServer(ctx);
    });

    async function connect() {
        const socket = await connectClient(ctx.port);
        clients.push(socket);
        return socket;
    }

    it('joins sockets to the fixed room and tracks the user count', async () => {
        const a = await connect();
        expect(await waitForCounts(a, 1)).toEqual([1]);
        await waitFor(() => ctx.io.sockets.adapter.rooms.get(ROOM), 'the room to exist');
        expect(ctx.io.sockets.adapter.rooms.get(ROOM).size).toBe(1);

        const b = await connect();
        expect(await waitForCounts(a, 2)).toEqual([1, 2]);

        b.close();
        expect(await waitForCounts(a, 3)).toEqual([1, 2, 1]);
        expect(ctx.getOnlineUsers()).toBe(1);
    });

    it('relays raw message payloads to the peer only', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const received = once(b, 'receive_message');
        const notEchoed = never(a, 'receive_message');
        a.emit('send_message', { text: 'hello', fromName: 'Aurora' });

        expect(await received).toEqual({ text: 'hello', fromName: 'Aurora' });
        await notEchoed;
    });

    it('relays typing status and call signaling', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const typing = once(b, 'user_typing');
        a.emit('typing', false);
        expect(await typing).toBe(false);

        const incoming = once(b, 'incoming_call');
        a.emit('call_user', { signal: { sdp: 'offer' }, isVideo: false });
        expect(await incoming).toEqual({ signal: { sdp: 'offer' }, isVideo: false });

        const accepted = once(a, 'call_accepted');
        b.emit('answer_call', { signal: { sdp: 'answer' } });
        expect(await accepted).toEqual({ sdp: 'answer' });
    });

    it('tolerates call events sent without a payload', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const incoming = once(b, 'incoming_call');
        a.emit('call_user');
        expect(await incoming).toEqual({});

        const accepted = once(b, 'call_accepted');
        a.emit('answer_call');
        expect(await accepted).toBeNull();
    });

    it('broadcasts call_ended to both peers on hangup', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const endedForCaller = once(a, 'call_ended');
        const endedForPeer = once(b, 'call_ended');
        a.emit('hangup');
        await Promise.all([endedForCaller, endedForPeer]);
    });
});
