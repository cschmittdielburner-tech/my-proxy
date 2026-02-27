const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer-core');

const MY_SECRET_KEY = "StudyHard2026";
const PORT = process.env.PORT || 3000;

// Use the system Chrome installed by the Dockerfile
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

let browser;

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        console.log('Browser launched from: ' + CHROME_PATH);
    }
    return browser;
}

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
            document.getElementById('status').textContent = 'Loading... (may take 20-30 seconds)';
            document.getElementById('display').src = '/?url=' + encodeURIComponent(targetUrl) + '&key=' + encodeURIComponent(key);
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
    const query = url.parse(req.url, true).query;
    const userKey = query.key;
    const targetUrl = query.url;

    if (!targetUrl) {
        serveUI(res);
        return;
    }

    if (userKey !== MY_SECRET_KEY) {
        res.writeHead(401);
        res.end('ACCESS DENIED');
        return;
    }

    let page;
    try {
        console.log(`Loading: ${targetUrl}`);
        const b = await getBrowser();
        page = await b.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Extra wait for JS-heavy sites
        await new Promise(r => setTimeout(r, 2000));

        const content = await page.content();
        console.log(`Done: ${page.url()}`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);

    } catch (err) {
        console.error('Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="background:#111;color:red;font-family:monospace;padding:20px;">
            <h2>Error loading page</h2><p>${err.message}</p>
        </body></html>`);
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
        res.writeHead(500);
        res.end('Server error: ' + err.message);
    });
});

server.listen(PORT, async () => {
    console.log(`Proxy running on port ${PORT}`);
    try {
        await getBrowser();
        console.log('Browser ready');
    } catch (e) {
        console.error('Browser pre-warm failed:', e.message);
    }
});
