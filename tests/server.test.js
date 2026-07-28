const request = require('supertest');
const { createApp, buildEnvelope, createChatServer, ROOM } = require('../server');
const { startServer, stopServer, connectClient, waitFor, waitForCounts, once, never } = require('./helpers');

describe('server.js health endpoint', () => {
    it('responds to GET / with the running message', async () => {
        const res = await request(createApp()).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Instant Chat Server is Running perfectly!');
    });

    it('enables permissive CORS', async () => {
        const res = await request(createApp()).get('/');
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('returns 404 for unknown routes', async () => {
        const res = await request(createApp()).get('/does-not-exist');
        expect(res.status).toBe(404);
    });
});

describe('buildEnvelope', () => {
    it('fills defaults from the socket id when fields are missing', () => {
        const before = Date.now();
        const envelope = buildEnvelope('abcdef123456', {});
        expect(envelope.from).toBe('abcdef123456');
        expect(envelope.fromName).toBe('User-abcd');
        expect(envelope.text).toBe('');
        expect(envelope.attachment).toBeNull();
        expect(envelope.ts).toBeGreaterThanOrEqual(before);
    });

    it('keeps client supplied fields', () => {
        const envelope = buildEnvelope('abcdef123456', {
            fromName: 'Aurora',
            text: 'hello',
            attachment: { type: 'image', data: 'x' },
            ts: 1234
        });
        expect(envelope).toEqual({
            from: 'abcdef123456',
            fromName: 'Aurora',
            text: 'hello',
            attachment: { type: 'image', data: 'x' },
            ts: 1234
        });
    });

    it('treats empty strings and missing data as absent', () => {
        const envelope = buildEnvelope('abcdef123456', { fromName: '', text: '' });
        expect(envelope.fromName).toBe('User-abcd');
        expect(envelope.text).toBe('');
        expect(buildEnvelope('abcdef123456').text).toBe('');
    });
});

describe('server.js socket handlers', () => {
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

    it('joins every socket to the fixed chat room', async () => {
        await connect();
        await waitFor(() => ctx.io.sockets.adapter.rooms.get(ROOM), 'the room to exist');
        expect(ctx.io.sockets.adapter.rooms.get(ROOM).size).toBe(1);
    });

    it('broadcasts the online user count on connect and disconnect', async () => {
        const a = await connect();
        expect(await waitForCounts(a, 1)).toEqual([1]);

        const b = await connect();
        expect(await waitForCounts(a, 2)).toEqual([1, 2]);
        expect(ctx.getOnlineUsers()).toBe(2);

        b.close();
        expect(await waitForCounts(a, 3)).toEqual([1, 2, 1]);
        expect(ctx.getOnlineUsers()).toBe(1);
    });

    it('relays messages as envelopes to the peer only', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const received = once(b, 'receive_message');
        const notEchoed = never(a, 'receive_message');
        a.emit('send_message', { fromName: 'Aurora', text: 'hi there', ts: 42 });

        const envelope = await received;
        expect(envelope).toEqual({
            from: a.id,
            fromName: 'Aurora',
            text: 'hi there',
            attachment: null,
            ts: 42
        });
        await notEchoed;
    });

    it('relays typing status', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const typing = once(b, 'user_typing');
        a.emit('typing', true);
        expect(await typing).toBe(true);
    });

    it('relays call signaling between peers', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const incoming = once(b, 'incoming_call');
        a.emit('call_user', { signal: { sdp: 'offer' }, isVideo: true });
        expect(await incoming).toEqual({
            signal: { sdp: 'offer' },
            callerName: 'User-' + a.id.slice(0, 4),
            isVideo: true
        });

        const accepted = once(a, 'call_accepted');
        b.emit('answer_call', { signal: { sdp: 'answer' } });
        expect(await accepted).toEqual({ sdp: 'answer' });

        const declined = once(a, 'call_declined');
        b.emit('decline_call');
        await declined;
    });

    it('notifies both peers when a call is hung up', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const endedForCaller = once(a, 'call_ended');
        const endedForPeer = once(b, 'call_ended');
        a.emit('hangup');
        await Promise.all([endedForCaller, endedForPeer]);
    });

    it('relays game moves to the peer only', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const received = once(b, 'receive_game');
        const notEchoed = never(a, 'receive_game');
        a.emit('send_game', { type: 'ttt_move', data: { index: 4, mark: 'X' } });

        expect(await received).toEqual({ type: 'ttt_move', data: { index: 4, mark: 'X' } });
        await notEchoed;
    });

    it('tolerates call events sent without a payload', async () => {
        const a = await connect();
        const b = await connect();
        await waitForCounts(b, 1);

        const incoming = once(b, 'incoming_call');
        a.emit('call_user');
        expect(await incoming).toEqual({ callerName: 'User-' + a.id.slice(0, 4) });

        const accepted = once(b, 'call_accepted');
        a.emit('answer_call');
        expect(await accepted).toBeNull();
    });
});
