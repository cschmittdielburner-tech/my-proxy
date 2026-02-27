const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

function rewriteUrls(body, base, contentType) {
    const key = `&key=${MY_SECRET_KEY}`;

    if (contentType.includes('text/html')) {
        // Rewrite absolute URLs
        body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_, u) => `href="/?url=${encodeURIComponent(u)}${key}"`);
        body = body.replace(/src="(https?:\/\/[^"]+)"/g, (_, u) => `src="/?url=${encodeURIComponent(u)}${key}"`);
        body = body.replace(/action="(https?:\/\/[^"]+)"/g, (_, u) => `action="/?url=${encodeURIComponent(u)}${key}"`);

        // Rewrite root-relative URLs correctly
        body = body.replace(/href="(\/[^"]*?)"/g, (_, path) => `href="/?url=${encodeURIComponent(base + path)}${key}"`);
        body = body.replace(/src="(\/[^"]*?)"/g, (_, path) => `src="/?url=${encodeURIComponent(base + path)}${key}"`);

        // Rewrite srcset
        body = body.replace(/srcset="([^"]+)"/g, (_, srcset) => {
            const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, (u) => `/?url=${encodeURIComponent(u)}${key}`);
            return `srcset="${rewritten}"`;
        });
    }

    if (contentType.includes('text/css')) {
        // Rewrite url() references inside CSS files
        body = body.replace(/url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/g, (_, u) => `url(/?url=${encodeURIComponent(u)}${key})`);
        body = body.replace(/url\(['"]?(\/[^'"\)]+)['"]?\)/g, (_, path) => `url(/?url=${encodeURIComponent(base + path)}${key})`);
    }

    return body;
}

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

        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-encoding'];
        delete headers['content-length'];

        res.writeHead(proxyRes.statusCode, headers);

        let stream = proxyRes;
        if (encoding === 'gzip') {
            stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
            stream = proxyRes.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
            stream = proxyRes.pipe(zlib.createBrotliDecompress());
        }

        const chunks = [];
        stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base = `${parsed.protocol}//${parsed.hostname}`;

            // Rewrite HTML and CSS, pass everything else through as binary
            if (contentType.includes('text/html') || contentType.includes('text/css')) {
                let body = buffer.toString('utf8');
                body = rewriteUrls(body, base, contentType);
                res.end(body);
            } else {
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
