const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const net = require('net');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

function rewriteUrls(body, base, contentType, key) {
    if (contentType.includes('text/html')) {
        body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_, u) => `href="/?url=${encodeURIComponent(u)}&key=${key}"`);
        body = body.replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="/?url=${encodeURIComponent(u)}&key=${key}"`);
        body = body.replace(/action="(https?:\/\/[^"]+)"/g, (_, u) => `action="/?url=${encodeURIComponent(u)}&key=${key}"`);
        body = body.replace(/href="(\/[^"]*?)"/g, (_, path) => `href="/?url=${encodeURIComponent(base + path)}&key=${key}"`);
        body = body.replace(/src="(\/[^"]*?)"/g, (_, path) => `src="/?url=${encodeURIComponent(base + path)}&key=${key}"`);
        body = body.replace(/srcset="([^"]+)"/g, (_, srcset) => {
            const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, (u) => `/?url=${encodeURIComponent(u)}&key=${key}`);
            return `srcset="${rewritten}"`;
        });
        body = body.replace(/<head>/i, `<head><base href="${base}/">`);
    }

    if (contentType.includes('text/css')) {
        body = body.replace(/url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/g, (_, u) => `url(/?url=${encodeURIComponent(u)}&key=${key})`);
        body = body.replace(/url\(['"]?(\/[^'"\)]+)['"]?\)/g, (_, path) => `url(/?url=${encodeURIComponent(base + path)}&key=${key})`);
    }

    return body;
}

function handleHttp(req, res) {
    const query = url.parse(req.url, true).query;
    const userKey = query.key;
    const targetUrl = query.url;

    if (userKey !== MY_SECRET_KEY) {
        res.writeHead(401);
        res.end("ACCESS DENIED");
        return;
    }

    if (!targetUrl) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("No URL provided");
        return;
    }

    const parsed = url.parse(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;
    const base = `${parsed.protocol}//${parsed.hostname}`;

    const options = {
        hostname: parsed.hostname,
        path: parsed.path || '/',
        method: req.method,
        headers: {
            ...req.headers,
            host: parsed.hostname,
            'accept-encoding': 'gzip, deflate, br'
        }
    };

    delete options.headers['x-forwarded-for'];
    delete options.headers['origin'];
    delete options.headers['referer'];

    const proxyReq = protocol.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        const contentType = proxyRes.headers['content-type'] || '';

        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-encoding'];
        delete headers['content-length'];
        headers['access-control-allow-origin'] = '*';

        res.writeHead(proxyRes.statusCode, headers);

        let stream = proxyRes;
        if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());

        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (contentType.includes('text/html') || contentType.includes('text/css')) {
                let body = buffer.toString('utf8');
                body = rewriteUrls(body, base, contentType, MY_SECRET_KEY);
                res.end(body);
            } else {
                res.end(buffer);
            }
        });

        stream.on('error', err => res.end("Decompression error: " + err.message));
    });

    proxyReq.on('error', err => {
        res.writeHead(500);
        res.end("Proxy error: " + err.message);
    });

    req.pipe(proxyReq);
}

function handleWebSocket(req, socket, head) {
    const query = url.parse(req.url, true).query;
    const userKey = query.key;
    const targetUrl = query.url;

    if (userKey !== MY_SECRET_KEY) { socket.destroy(); return; }
    if (!targetUrl) { socket.destroy(); return; }

    const wsUrl = targetUrl.replace(/^http/, 'ws');
    const parsed = url.parse(wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    const port = parsed.port || (isSecure ? 443 : 80);

    const targetSocket = net.connect(port, parsed.hostname, () => {
        const upgradeReq = [
            `GET ${parsed.path || '/'} HTTP/1.1`,
            `Host: ${parsed.hostname}`,
            `Upgrade: websocket`,
            `Connection: Upgrade`,
            `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || ''}`,
            `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
            '', ''
        ].join('\r\n');
        targetSocket.write(upgradeReq);
    });

    targetSocket.on('data', data => socket.write(data));
    socket.on('data', data => targetSocket.write(data));
    targetSocket.on('end', () => socket.end());
    socket.on('end', () => targetSocket.end());
    targetSocket.on('error', () => socket.destroy());
    socket.on('error', () => targetSocket.destroy());
}

const server = http.createServer((req, res) => {
    handleHttp(req, res);
});

server.on('upgrade', (req, socket, head) => {
    handleWebSocket(req, socket, head);
});

// 0.0.0.0 is required for Railway to accept external connections
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Proxy running on port ${PORT}`);
});
