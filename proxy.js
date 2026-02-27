const http = require('http');
const https = require('https');
const url = require('url');

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
            host: parsed.hostname  // critical - makes the site think its a direct request
        }
    };

    // Strip these headers so sites don't block the iframe
    delete options.headers['x-forwarded-for'];

    const proxyReq = protocol.request(options, (proxyRes) => {
        let body = '';

        // Strip CSP and framing headers from the response
        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['x-frame-options'];
        delete headers['content-encoding']; // important - lets us rewrite the body

        res.writeHead(proxyRes.statusCode, headers);

        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
            // Rewrite URLs in HTML so links go through your proxy
            if (headers['content-type'] && headers['content-type'].includes('text/html')) {
                const base = `${parsed.protocol}//${parsed.hostname}`;
                body = body.replace(/href="\/([^"]*?)"/g, `href="/?url=${base}/$1&key=${MY_SECRET_KEY}"`);
                body = body.replace(/src="\/([^"]*?)"/g, `src="/?url=${base}/$1&key=${MY_SECRET_KEY}"`);
            }
            res.end(body);
        });
    });

    proxyReq.on('error', (err) => {
        res.end("Error: " + err.message);
    });

    proxyReq.end();

}).listen(PORT, () => console.log(`Proxy running on port ${PORT}`));const http = require('http');
