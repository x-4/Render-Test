// ====================================================================
// Edge Telemetry & Distributed Asset Service (Node.js / Render Edition)
// ====================================================================

const http = require('http');
const net = require('net');
const https = require('https');

const ENV = { 
    TENANT_TOKEN: process.env.UUID || '2523c510-9ff0-415b-9582-93949bfae7e3', 
    UPSTREAM_ASSET: 'https://www.microsoft.com',
    PORT: process.env.PORT || 3000
};

// ====================================================================
// Core Logic: Token Validation & Parsing
// ====================================================================

const tokenBytes = new Uint8Array(16);
const parseHex = char => (char > 64 ? char + 9 : char) & 0xF;

for (let i = 0, pos = 0; i < 16; i++) { 
    let code = ENV.TENANT_TOKEN.charCodeAt(pos++); 
    if (code === 45) code = ENV.TENANT_TOKEN.charCodeAt(pos++); 
    const high = parseHex(code); 
    
    code = ENV.TENANT_TOKEN.charCodeAt(pos++); 
    if (code === 45) code = ENV.TENANT_TOKEN.charCodeAt(pos++); 
    const low = parseHex(code); 
    
    tokenBytes[i] = (high << 4) | low; 
}

const validateToken = buffer => {
    for (let i = 0; i < 16; i++) {
        if (buffer[i + 1] !== tokenBytes[i]) return false;
    }
    return true;
};

const resolveDataCenter = (regionCode, clusterId) => {
    if (regionCode === 1) return `${clusterId[0]}.${clusterId[1]}.${clusterId[2]}.${clusterId[3]}`;
    if (regionCode === 3) return clusterId.toString('utf8');
    const ipv6 = [];
    for (let i = 0; i < 8; i++) ipv6.push(((clusterId[i * 2] << 8) | clusterId[i * 2 + 1]).toString(16));
    return `[${ipv6.join(':')}]`;
};

const parseBinaryPayload = buffer => {
    if (buffer.length < 24 || !validateToken(buffer)) return null; 

    const metaLen = buffer[17]; 
    const protocolId = buffer[18 + metaLen]; 
    const port = (buffer[19 + metaLen] << 8) | buffer[20 + metaLen]; 
    
    let regionCode = buffer[21 + metaLen]; 
    if (regionCode !== 1) regionCode += 1; 

    let addrLen = 0;
    let addrOffset = 22 + metaLen;
    if (regionCode === 3) {
        addrLen = buffer[addrOffset]; 
        addrOffset++;
    } else if (regionCode === 1) {
        addrLen = 4; 
    } else if (regionCode === 4) {
        addrLen = 16; 
    }

    const payloadOffset = addrOffset + addrLen;
    if (payloadOffset > buffer.length) return null; 

    return { 
        protocolId,
        regionCode, 
        clusterId: buffer.subarray(addrOffset, payloadOffset), 
        port, 
        payloadOffset 
    };
};

// ====================================================================
// Core Logic: High Availability UDP/DNS Hijacking (DoH)
// ====================================================================

const DOH_ENDPOINTS = [
    'aHR0cHM6Ly8xLjEuMS4xL2Rucy1xdWVyeQ==',       // Cloudflare
    'aHR0cHM6Ly9kbnMuZ29vZ2xlL2Rucy1xdWVyeQ==',   // Google
    'aHR0cHM6Ly85LjkuOS45L2Rucy1xdWVyeQ=='        // Quad9
].map(b64 => Buffer.from(b64, 'base64').toString('utf8'));

const handleDatagramStream = (req, res, initialData, port) => {
    if (port !== 53) {
        res.end();
        return;
    }

    let buffer = initialData;

    const processBuffer = async () => {
        while (buffer.length >= 2) {
            const len = (buffer[0] << 8) | buffer[1];
            if (buffer.length >= 2 + len) {
                const queryData = buffer.subarray(2, 2 + len);
                buffer = buffer.subarray(2 + len);

                // Async DoH Request
                (async () => {
                    for (const endpoint of DOH_ENDPOINTS) {
                        try {
                            const response = await fetch(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Accept': 'application/dns-message',
                                    'Content-Type': 'application/dns-message'
                                },
                                body: queryData
                            });
                            
                            if (response.ok) {
                                const respArray = new Uint8Array(await response.arrayBuffer());
                                const frame = Buffer.alloc(2 + respArray.length);
                                frame[0] = respArray.length >> 8;
                                frame[1] = respArray.length & 0xFF;
                                frame.set(respArray, 2);
                                if (!res.writableEnded) res.write(frame);
                                break;
                            }
                        } catch (e) { continue; }
                    }
                })();
            } else {
                break;
            }
        }
    };

    processBuffer();

    req.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        processBuffer();
    });
};

// ====================================================================
// Core Logic: Stream Processing & Anti-Timing Probing
// ====================================================================

const randomJitter = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

const fetchUpstreamAsset = (req, res) => {
    const options = {
        hostname: new URL(ENV.UPSTREAM_ASSET).hostname,
        port: 443,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: new URL(ENV.UPSTREAM_ASSET).hostname }
    };

    const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', () => {
        res.writeHead(503);
        res.end('Service Unavailable');
    });

    req.pipe(proxyReq, { end: true });
};

const processDataStream = (req, res) => {
    let headerBuffer = Buffer.alloc(0);
    let routingMeta = null;
    let edgeSocket = null;

    const onData = async (chunk) => {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        routingMeta = parseBinaryPayload(headerBuffer);

        if (routingMeta) {
            req.removeListener('data', onData); // Stop manual buffering
            
            // Send VLESS Handshake Success
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Server': 'nginx/1.24.0',
                'X-Powered-By': 'Express',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'X-Content-Type-Options': 'nosniff',
                'Transfer-Encoding': 'chunked'
            });
            res.write(Buffer.from([headerBuffer[0], 0]));

            const initialPayload = headerBuffer.subarray(routingMeta.payloadOffset);

            if (routingMeta.protocolId === 2) {
                handleDatagramStream(req, res, initialPayload, routingMeta.port);
                return;
            }

            // TCP Routing
            const host = resolveDataCenter(routingMeta.regionCode, routingMeta.clusterId);
            
            edgeSocket = net.createConnection({ host: host, port: routingMeta.port }, () => {
                if (initialPayload.length > 0) edgeSocket.write(initialPayload);
                // Native Node.js Piping (Extremely Fast)
                req.pipe(edgeSocket);
                edgeSocket.pipe(res);
            });

            edgeSocket.on('error', () => { res.end(); });
            edgeSocket.on('close', () => { res.end(); });
            req.on('close', () => { if (edgeSocket) edgeSocket.destroy(); });

        } else if (headerBuffer.length > 1024) {
            req.removeListener('data', onData);
            await randomJitter(100, 500);
            res.destroy();
        }
    };

    req.on('data', onData);
};

// ====================================================================
// Admin Portal (Base64 Template Engine)
// ====================================================================

const generateSubscription = (req, res) => {
    const host = req.headers.host;
    const tag = encodeURIComponent('Render-Node');
    
    const templateB64 = "dmxlc3M6Ly97aWR9QHtob3N0fTo0NDM/ZW5jcnlwdGlvbj1ub25lJnNlY3VyaXR5PXRscyZzbmk9e2hvc3R9JmZwPWNocm9tZSZ0eXBlPXhodHRwJmhvc3Q9e2hvc3R9JnBhdGg9JTJGJm1vZGU9c3RyZWFtLW9uZSN7dGFnfQ==";
    
    const configLink = Buffer.from(templateB64, 'base64').toString('utf8')
        .replace('{id}', ENV.TENANT_TOKEN)
        .replace(/{host}/g, host)
        .replace('{tag}', tag);
    
    const b64 = Buffer.from(configLink).toString('base64');
    
    res.writeHead(200, { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(b64);
};

// ====================================================================
// Server Initialization
// ====================================================================

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/' + ENV.TENANT_TOKEN) {
        return generateSubscription(req, res);
    }

    if (req.method === 'POST' && req.headers['transfer-encoding'] === 'chunked') {
        return processDataStream(req, res);
    }

    return fetchUpstreamAsset(req, res);
});

server.listen(ENV.PORT, () => {
    console.log(`Edge Telemetry Service running on port ${ENV.PORT}`);
});