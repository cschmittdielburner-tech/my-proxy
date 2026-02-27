const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    const query = url.parse(req.url, true).query;
    const userKey = query.key;
    const targetUrl = query.url;

    if (userKey !== MY_SECRET_KEY) {
        res.writeHead(401);
        res.end("ACCESS DENIED");
        return;
    }

    if (!targetUrl) {
        res.end("No URL provided");
        return;
    }

    const parsed = url.parse(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const options = {
        hostname: parsed.hostname,
        path: parsed.path,
        method: req.method,
        headers: {
            ...req.headers,
            host: parsed.hostname
        }
    };

    delete options.headers['x-forwarded-for'];

    const proxyReq = protocol.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];

        // Strip security and encoding headers
        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-encoding'];

        res.writeHead(proxyRes.statusCode, headers);

        // Decompress based on encoding
        let stream = proxyRes;
        if (encoding === 'gzip') {
            stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
            stream = proxyRes.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
            stream = proxyRes.pipe(zlib.createBrotliDecompress());
        }

        let body = '';
        stream.on('data', chunk => body += chunk);
        stream.on('end', () => {
            if (headers['content-type'] && headers['content-type'].includes('text/html')) {
                const base = `${parsed.protocol}//${parsed.hostname}`;
                body = body.replace(/href="\/([^"]*?)"/g, `href="/?url=${base}/$1&key=${MY_SECRET_KEY}"`);
                body = body.replace(/src="\/([^"]*?)"/g, `src="/?url=${base}/$1&key=${MY_SECRET_KEY}"`);
            }
            res.end(body);
        });

        stream.on('error', (err) => {
            res.end("Decompression error: " + err.message);
        });
    });

    proxyReq.on('error', (err) => {
        res.end("Error: " + err.message);
    });

    proxyReq.end();

}).listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
