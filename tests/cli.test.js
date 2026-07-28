const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function startEntrypoint(file, port) {
    const child = spawn(process.execPath, [path.join(ROOT, file)], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${file} did not report a listening port`)), 10000);
        child.stdout.on('data', (chunk) => {
            if (chunk.toString().includes(`Server running on port ${port}`)) {
                clearTimeout(timer);
                resolve(child);
            }
        });
        child.on('error', reject);
    });
}

function stopEntrypoint(child) {
    return new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGKILL');
    });
}

function get(port) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

describe.each([
    ['server.js', 3411, 'Instant Chat Server is Running perfectly!'],
    ['index.js', 3412, 'Instant Chat Server is Running perfectly without DB!']
])('%s run directly', (file, port, expectedBody) => {
    let child;

    afterEach(async () => {
        if (child) await stopEntrypoint(child);
    });

    it('listens on process.env.PORT and serves the health check', async () => {
        child = await startEntrypoint(file, port);
        const res = await get(port);
        expect(res.status).toBe(200);
        expect(res.body).toBe(expectedBody);
    });
});
