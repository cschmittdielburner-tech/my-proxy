const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const net = require('net');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

// ─── URL Rewriting ────────────────────────────────────────────────────────────

function rewriteUrls(body, base, contentType, key) {
    if (contentType.includes('text/html')) {
        // Absolute URLs
        body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_, u) => `href="/?url=${encodeURIComponent(u)}&key=${key}"`);
        body = body.replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="/?url=${encodeURIComponent(u)}&key=${key}"`);
        body = body.replace(/action="(https?:\/\/[^"]+)"/g, (_, u) => `action="/?url=${encodeURIComponent(u)}&key=${key}"`);

        // Root-relative URLs
        body = body.replace(/href="(\/[^"]*?)"/g, (_, path) => `href="/?url=${encodeURIComponent(base + path)}&key=${key}"`);
        body = body.replace(/src="(\/[^"]*?)"/g, (_, path) => `src="/?url=${encodeURIComponent(base + path)}&key=${key}"`);

        // Srcset
        body = body.replace(/srcset="([^"]+)"/g, (_, srcset) => {
            const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, (u) => `/?url=${encodeURIComponent(u)}&key=${key}`);
            return `srcset="${rewritten}"`;
        });

        // Rewrite WebSocket URLs in inline scripts (ws:// and wss://)
        body = body.replace(/(["'`])(wss?:\/\/[^"'`\s]+)(["'`])/g, (_, q1, wsUrl, q2) => {
            const rewritten = wsUrl.replace('wss://', 'wss://').replace('ws://', 'ws://');
            return `${q1}${rewritten}${q2}`;
        });

        // Inject a base tag so relative URLs resolve correctly
        body = body.replace(/<head>/i, `<head><base href="${base}/">`);
    }

    if (contentType.includes('text/css')) {
        body = body.replace(/url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/g, (_, u) => `url(/?url=${encodeURIComponent(u)}&key=${key})`);
        body = body.replace(/url\(['"]?(\/[^'"\)]+)['"]?\)/g, (_, path) => `url(/?url=${encodeURIComponent(base + path)}&key=${key})`);
    }

    return body;
}

// ─── HTTP Proxy ───────────────────────────────────────────────────────────────

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

    // Clean up headers that can cause issues
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
        // Allow cross-origin requests for games and assets
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

    // Forward request body (for POST requests)
    req.pipe(proxyReq);
}

// ─── WebSocket Proxy ──────────────────────────────────────────────────────────

function handleWebSocket(req, socket, head) {
    const query = url.parse(req.url, true).query;
    const userKey = query.key;
    const targetUrl = query.url;

    if (userKey !== MY_SECRET_KEY) {
        socket.destroy();
        return;
    }

    if (!targetUrl) {
        socket.destroy();
        return;
    }

    // Convert http/https to ws/wss
    const wsUrl = targetUrl.replace(/^http/, 'ws');
    const parsed = url.parse(wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    const port = parsed.port || (isSecure ? 443 : 80);

    // Create a raw TCP connection to the target WebSocket server
    const targetSocket = net.connect(port, parsed.hostname, () => {
        // Forward the upgrade request
        const upgradeReq = [
            `GET ${parsed.path || '/'} HTTP/1.1`,
            `Host: ${parsed.hostname}`,
            `Upgrade: websocket`,
            `Connection: Upgrade`,
            `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || ''}`,
            `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
            '',
            ''
        ].join('\r\n');

        targetSocket.write(upgradeReq);
    });

    // Pipe data between client and target
    targetSocket.on('data', data => socket.write(data));
    socket.on('data', data => targetSocket.write(data));

    targetSocket.on('end', () => socket.end());
    socket.on('end', () => targetSocket.end());

    targetSocket.on('error', () => socket.destroy());
    socket.on('error', () => targetSocket.destroy());
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    handleHttp(req, res);
});

// Attach WebSocket upgrade handler
server.on('upgrade', (req, socket, head) => {
    handleWebSocket(req, socket, head);
});

server.listen(PORT, () => {
    console.log(`Proxy with WebSocket support running on port ${PORT}`);
});
