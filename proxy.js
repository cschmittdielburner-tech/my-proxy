const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

const proxy = httpProxy.createProxyServer({});

// CHANGE THIS: This is your secret access key
const MY_SECRET_KEY = "StudyHard2026";

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const query = parsed.query;
    const pathname = parsed.pathname;

    // Only handle /proxy route
    if (pathname !== '/proxy') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    const targetUrl = query.url;
    const userKey = query.key;

    // Security Gatekeeper
    if (userKey !== MY_SECRET_KEY) {
        res.writeHead(401, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
                <body style="background:#000;color:red;display:flex;justify-content:center;align-items:center;height:100vh;font-family:monospace;">
                    <h1>ACCESS DENIED: Unauthorized Key</h1>
                </body>
            </html>
        `);
        return;
    }

    if (targetUrl) {
        console.log(`Proxying request to: ${targetUrl}`);
        proxy.web(req, res, {
            target: targetUrl,
            changeOrigin: true,
            followRedirects: true
        }, (err) => {
            res.end("Proxy Error: " + err.message);
        });
    } else {
        res.end("Waiting for target URL...");
    }
});

// Use the port assigned by the cloud provider
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Secure Proxy active on port ${PORT}`);
});
