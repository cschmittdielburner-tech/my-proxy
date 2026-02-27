const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

let browser;

// Launch browser once and reuse it
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',        // allow cross-origin requests
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        console.log('Browser launched');
    }
    return browser;
}

// Serve the control UI when no URL is provided
function serveUI(res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>Proxy</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #111; color: #00ff41; font-family: monospace; display: flex; flex-direction: column; height: 100vh; }
        .bar { padding: 12px; background: #000; display: flex; gap: 8px; border-bottom: 2px solid #00ff41; }
        input { background: #222; color: #fff; border: 1px solid #444; padding: 8px; border-radius: 4px; font-size: 14px; }
        #urlInput { flex-grow: 1; }
        button { background: #00ff41; color: #000; border: none; padding: 8px 16px; cursor: pointer; font-weight: bold; border-radius: 4px; }
        iframe { flex-grow: 1; border: none; background: #fff; }
        #status { padding: 6px 12px; background: #222; font-size: 12px; color: #888; }
    </style>
</head>
<body>
    <div class="bar">
        <input type="text" id="urlInput" placeholder="Enter URL (https://...)" />
        <input type="password" id="keyInput" placeholder="Secret Key" />
        <button onclick="launch()">Launch</button>
    </div>
    <div id="status">Ready</div>
    <iframe id="display"></iframe>
    <script>
        function launch() {
            const targetUrl = document.getElementById('urlInput').value;
            const key = document.getElementById('keyInput').value;
            if (!targetUrl || !key) return alert('Enter a URL and key');
            document.getElementById('status').textContent = 'Loading... (first load may take 10-20 seconds)';
            document.getElementById('display').src = '/load?url=' + encodeURIComponent(targetUrl) + '&key=' + encodeURIComponent(key);
            document.getElementById('display').onload = () => {
                document.getElementById('status').textContent = 'Loaded: ' + targetUrl;
            };
        }
    </script>
</body>
</html>
    `);
}

async function handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query = parsed.query;

    // Serve UI at root
    if (pathname === '/' && !query.url) {
        serveUI(res);
        return;
    }

    const userKey = query.key;
    const targetUrl = query.url;

    // Auth check
    if (userKey !== MY_SECRET_KEY) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ACCESS DENIED');
        return;
    }

    if (!targetUrl) {
        serveUI(res);
        return;
    }

    let page;
    try {
        console.log(`Loading: ${targetUrl}`);
        const b = await getBrowser();
        page = await b.newPage();

        // Pretend to be a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Set viewport to full size
        await page.setViewport({ width: 1280, height: 800 });

        // Navigate and wait for the page to fully load
        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait a little extra for JS-heavy sites and games
        await new Promise(r => setTimeout(r, 2000));

        // Get the fully rendered HTML after JS has run
        const content = await page.content();

        // Take a screenshot as a fallback check
        const pageUrl = page.url();
        console.log(`Loaded: ${pageUrl}`);

        res.writeHead(200, {
            'Content-Type': 'text/html',
            'X-Proxied-Url': pageUrl
        });
        res.end(content);

    } catch (err) {
        console.error('Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
            <html><body style="background:#111;color:red;font-family:monospace;padding:20px;">
                <h2>Error loading page</h2>
                <p>${err.message}</p>
                <p>Try a different URL or check that it's reachable.</p>
            </body></html>
        `);
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
    }
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
        console.error('Unhandled error:', err);
        res.writeHead(500);
        res.end('Server error: ' + err.message);
    });
});

server.listen(PORT, async () => {
    console.log(`Puppeteer proxy running on port ${PORT}`);
    // Pre-warm the browser so the first request is faster
    try {
        await getBrowser();
        console.log('Browser ready and waiting');
    } catch (e) {
        console.error('Failed to pre-warm browser:', e.message);
    }
});
