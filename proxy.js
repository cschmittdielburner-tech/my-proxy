{\rtf1\ansi\ansicpg1252\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 const http = require('http');\
const httpProxy = require('http-proxy');\
const url = require('url');\
\
const proxy = httpProxy.createProxyServer(\{\});\
\
// CHANGE THIS: This is your secret access key\
const MY_SECRET_KEY = "StudyHard2026"; \
\
const server = http.createServer((req, res) => \{\
    const query = url.parse(req.url, true).query;\
    const targetUrl = query.url;\
    const userKey = query.key;\
\
    // Security Gatekeeper\
    if (userKey !== MY_SECRET_KEY) \{\
        res.writeHead(401, \{ 'Content-Type': 'text/html' \});\
        res.end(`\
            <html>\
                <body style="background:#000;color:red;display:flex;justify-content:center;align-items:center;height:100vh;font-family:monospace;">\
                    <h1>ACCESS DENIED: Unauthorized Key</h1>\
                </body>\
            </html>\
        `);\
        return;\
    \}\
\
    if (targetUrl) \{\
        console.log(`Proxying request to: $\{targetUrl\}`);\
        proxy.web(req, res, \{ \
            target: targetUrl, \
            changeOrigin: true,\
            followRedirects: true \
        \}, (err) => \{\
            res.end("Proxy Error: " + err.message);\
        \});\
    \} else \{\
        res.end("Waiting for target URL...");\
    \}\
\});\
\
// Use the port assigned by the cloud provider\
const PORT = process.env.PORT || 3000;\
server.listen(PORT, () => \{\
    console.log(`Secure Proxy active on port $\{PORT\}`);\
\});}