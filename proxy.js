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
            host: parsed.hostname,
            'accept-encoding': 'gzip, deflate, br'
        }
    };

    delete options.headers['x-forwarded-for'];

    const proxyReq = protocol.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        const contentType = proxyRes.headers['content-type'] || '';

        // Strip security and encoding headers
        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-encoding'];
        delete headers['content-length'];

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

        // Collect chunks as buffers
        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);

            if (contentType.includes('text/html')) {
                let body = buffer.toString('utf8');
                const base = `${parsed.protocol}//${parsed.hostname}`;
                const key = `&key=${MY_SECRET_KEY}`;

                // Rewrite absolute URLs (https://example.com/path)
                body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_, u) => `href="/?url=${encodeURIComponent(u)}${key}"`);
                body = body.replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="/?url=${encodeURIComponent(u)}${key}"`);
                body = body.replace(/action="(https?:\/\/[^"]+)"/g, (_, u) => `action="/?url=${encodeURIComponent(u)}${key}"`);

                // Rewrite root-relative URLs (/path)
                body = body.replace(/href="\//g, `href="/?url=${encodeURIComponent(base + '/')}${key}&p=`);
                body = body.replace(/src="\//g, `src="/?url=${encodeURIComponent(base + '/')}${key}&p=`);

                // Rewrite srcset attributes (used for responsive images)
                body = body.replace(/srcset="([^"]+)"/g, (_, srcset) => {
                    const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, (u) => `/?url=${encodeURIComponent(u)}${key}`);
                    return `srcset="${rewritten}"`;
                });

                res.end(body);
            } else {
                // Send binary data (images, fonts, etc.) as-is
                res.end(buffer);
            }
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
