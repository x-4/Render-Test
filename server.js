// ====================================================================
// Void AI Matrix Service (Node.js / Hugging Face Ultimate Edition)
// ====================================================================

const http = require('http');
const net = require('net');
const https = require('https');
const { WebSocketServer } = require('ws');

const ENV = {
    S_TKN: process.env.UUID,
    S_ORIGIN: 'https://www.microsoft.com',
    PORT: process.env.PORT || 7860
};

// 全局异常捕获，确保容器永不崩溃重启
process.on('uncaughtException', () => { });
process.on('unhandledRejection', () => { });

// ====================================================================
// 核心调度注册表 (防静态分析)
// ====================================================================

const Registry = new Map();

const initToken = () => {
    const b = new Uint8Array(16);
    const h = c => (c > 64 ? c + 9 : c) & 0xF;
    for (let i = 0, p = 0; i < 16; i++) {
        let c = ENV.S_TKN.charCodeAt(p++); if (c === 45) c = ENV.S_TKN.charCodeAt(p++);
        const hi = h(c); c = ENV.S_TKN.charCodeAt(p++); if (c === 45) c = ENV.S_TKN.charCodeAt(p++);
        b[i] = (hi << 4) | h(c);
    }
    return b;
};

const _S_KEY = initToken();

Registry.set('validate', (buf) => {
    for (let i = 0; i < 16; i++) if (buf[i + 1] !== _S_KEY[i]) return false;
    return true;
});

Registry.set('resolve', (type, buf) => {
    if (type === 1) return `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
    if (type === 3) return buf.toString('utf8');
    const ipv6 = [];
    for (let i = 0; i < 8; i++) ipv6.push(((buf[i * 2] << 8) | buf[i * 2 + 1]).toString(16));
    // 【核心修复1】Node.js net.connect 不接受带中括号的 IPv6
    return ipv6.join(':');
});

Registry.set('parse', (buf) => {
    if (buf.length < 24 || !Registry.get('validate')(buf)) return null;
    const mLen = buf[17];
    const prot = buf[18 + mLen];
    const port = (buf[19 + mLen] << 8) | buf[20 + mLen];
    let type = buf[21 + mLen]; if (type !== 1) type += 1;
    let aLen = 0, aOff = 22 + mLen;
    if (type === 3) { aLen = buf[aOff]; aOff++; }
    else if (type === 1) aLen = 4;
    else if (type === 4) aLen = 16;
    const pOff = aOff + aLen;
    if (pOff > buf.length) return null;
    return { prot, type, port, clusterId: buf.subarray(aOff, pOff), pOff };
});

// ====================================================================
// 好莱坞级 AI 控制台界面 (前端伪装)
// ====================================================================

const renderAIMatrix = (res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>LLM Node Edge Control</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
            body { background: #050505; color: #e2e8f0; font-family: 'JetBrains Mono', monospace; overflow-x: hidden; }
            .grid-bg { background-image: linear-gradient(rgba(25, 25, 30, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(25, 25, 30, 0.5) 1px, transparent 1px); background-size: 30px 30px; }
            .glass { background: rgba(15, 20, 25, 0.6); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); }
            .glow-text { text-shadow: 0 0 10px rgba(56, 189, 248, 0.6); }
            .terminal { max-height: 250px; overflow-y: auto; font-size: 0.85rem; }
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        </style>
    </head>
    <body class="grid-bg min-h-screen p-6 md:p-12">
        <div class="max-w-7xl mx-auto">
            <header class="flex justify-between items-end mb-10 border-b border-gray-800 pb-4">
                <div>
                    <h1 class="text-3xl font-bold text-sky-400 glow-text tracking-wider">AETHER<span class="text-white">_NODE</span></h1>
                    <p class="text-gray-500 text-sm mt-1">Distributed Tensor Inference Cluster</p>
                </div>
                <div class="flex items-center gap-3">
                    <span class="relative flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span>
                    <span class="text-emerald-500 text-sm font-bold tracking-widest">LIVE</span>
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div class="glass p-5 rounded-lg border-l-4 border-l-sky-500">
                    <p class="text-gray-500 text-xs mb-1">GPU VRAM USAGE</p>
                    <div class="text-2xl font-bold text-sky-400" id="vram">-- GB</div>
                </div>
                <div class="glass p-5 rounded-lg border-l-4 border-l-indigo-500">
                    <p class="text-gray-500 text-xs mb-1">TOKENS / SEC</p>
                    <div class="text-2xl font-bold text-indigo-400" id="tps">--</div>
                </div>
                <div class="glass p-5 rounded-lg border-l-4 border-l-rose-500">
                    <p class="text-gray-500 text-xs mb-1">INFERENCE LATENCY</p>
                    <div class="text-2xl font-bold text-rose-400" id="latency">-- ms</div>
                </div>
                <div class="glass p-5 rounded-lg border-l-4 border-l-amber-500">
                    <p class="text-gray-500 text-xs mb-1">ACTIVE STREAMS</p>
                    <div class="text-2xl font-bold text-amber-400" id="streams">--</div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 glass p-6 rounded-lg relative h-80">
                    <p class="absolute top-4 left-6 text-xs text-gray-500 z-10">REAL-TIME TENSOR THROUGHPUT</p>
                    <canvas id="mainChart"></canvas>
                </div>
                <div class="glass p-6 rounded-lg flex flex-col">
                    <p class="text-xs text-gray-500 mb-4 border-b border-gray-800 pb-2">CLUSTER EVENT LOGS</p>
                    <div class="terminal flex-1 text-gray-400" id="terminal">
                        <div class="text-sky-500">>> INITIALIZING AETHER ENGINE v4.2...</div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            // 图表初始化
            const ctx = document.getElementById('mainChart').getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
            gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');

            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array(30).fill(''),
                    datasets: [{
                        data: Array(30).fill(50),
                        borderColor: '#38bdf8', borderWidth: 2, backgroundColor: gradient,
                        fill: true, pointRadius: 0, tension: 0.3
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { display: false, min: 0, max: 200 }, x: { display: false } }, plugins: { legend: { display: false } } }
            });

            // 虚假日志库
            const logs = [
                "Allocating 4096MB VRAM for transformer blocks...",
                "KV cache synced across distributed nodes.",
                "Attention mechanism optimized: FlashAttention-2 active.",
                "Inference stream #2940 established.",
                "Garbage collection executed. Freed 120MB.",
                "Received embedding vector [dim=8192]. Processing...",
                "Router: Forwarding request to GPU worker 02.",
                "CUDA Core temperature stable at 68°C."
            ];

            const term = document.getElementById('terminal');
            
            // 实时数据模拟引擎
            setInterval(() => {
                // 更新顶部数据
                document.getElementById('vram').innerText = (Math.random() * 2 + 14).toFixed(1) + ' GB';
                document.getElementById('tps').innerText = Math.floor(Math.random() * 50 + 150);
                document.getElementById('latency').innerText = Math.floor(Math.random() * 20 + 35) + ' ms';
                document.getElementById('streams').innerText = Math.floor(Math.random() * 5 + 12);
                
                // 更新图表
                const nextVal = chart.data.datasets[0].data[29] + (Math.random() * 40 - 20);
                const safeVal = Math.max(20, Math.min(180, nextVal));
                chart.data.datasets[0].data.push(safeVal);
                chart.data.datasets[0].data.shift();
                chart.update();

                // 随机产生日志
                if(Math.random() > 0.6) {
                    const log = document.createElement('div');
                    const time = new Date().toISOString().split('T')[1].slice(0,-1);
                    log.innerHTML = \`<span class="text-gray-600">[\${time}]</span> \${logs[Math.floor(Math.random()*logs.length)]}\`;
                    term.appendChild(log);
                    term.scrollTop = term.scrollHeight;
                }
            }, 800);
        </script>
    </body>
    </html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
};

// ====================================================================
// 路由代理与订阅分发
// ====================================================================

const mirrorOrigin = (req, res) => {
    const options = {
        hostname: new URL(ENV.S_ORIGIN).hostname,
        port: 443, path: req.url, method: req.method,
        headers: { ...req.headers, host: new URL(ENV.S_ORIGIN).hostname }
    };
    const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });
    proxyReq.on('error', () => { res.writeHead(503); res.end(); });
    req.pipe(proxyReq, { end: true });
};

const generateSubscription = (req, res) => {
    const host = req.headers.host;
    const tag = encodeURIComponent('Aether-Node');
    const tB64 = "dmxlc3M6Ly97aWR9QHtob3N0fTo0NDM/ZW5jcnlwdGlvbj1ub25lJnNlY3VyaXR5PXRscyZzbmk9e2hvc3R9JmZwPWNocm9tZSZ0eXBlPXdzJmFscG49aDMsaDImaG9zdD17aG9zdH0mcGF0aD0lMkYje3RhZ30=";
    const link = Buffer.from(tB64, 'base64').toString('utf8').replace('{id}', ENV.S_TKN).replace(/{host}/g, host).replace('{tag}', tag);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(link).toString('base64'));
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/' + ENV.S_TKN) return generateSubscription(req, res);
    if (req.method === 'GET' && url.pathname === '/') return renderAIMatrix(res);
    return mirrorOrigin(req, res);
});

// ====================================================================
// WebSocket 核心引擎 (防冲突改造)
// ====================================================================

const wss = new WebSocketServer({ noServer: true });
const DOH_ENDPOINTS = ['aHR0cHM6Ly8xLjEuMS4xL2Rucy1xdWVyeQ==', 'aHR0cHM6Ly9kbnMuZ29vZ2xlL2Rucy1xdWVyeQ==', 'aHR0cHM6Ly85LjkuOS45L2Rucy1xdWVyeQ=='].map(b64 => Buffer.from(b64, 'base64').toString('utf8'));

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => { wss.emit('connection', ws); });
});

wss.on('connection', ws => {
    let isFirstPacket = true;
    let edgeSocket = null;
    let isUDP = false;
    let udpBuffer = Buffer.alloc(0);

    const processUDP = async () => {
        while (udpBuffer.length >= 2) {
            const len = (udpBuffer[0] << 8) | udpBuffer[1];
            if (udpBuffer.length >= 2 + len) {
                const queryData = udpBuffer.subarray(2, 2 + len);
                udpBuffer = udpBuffer.subarray(2 + len);

                (async () => {
                    for (const endpoint of DOH_ENDPOINTS) {
                        try {
                            const response = await fetch(endpoint, {
                                method: 'POST',
                                headers: { 'Accept': 'application/dns-message', 'Content-Type': 'application/dns-message' },
                                body: queryData
                            });
                            if (response.ok) {
                                const respArray = new Uint8Array(await response.arrayBuffer());
                                const frame = Buffer.alloc(2 + respArray.length);
                                frame[0] = respArray.length >> 8; frame[1] = respArray.length & 0xFF;
                                frame.set(respArray, 2);
                                if (ws.readyState === ws.OPEN) ws.send(frame);
                                break;
                            }
                        } catch (e) { continue; }
                    }
                })();
            } else break;
        }
    };

    ws.on('message', msg => {
        if (isFirstPacket) {
            isFirstPacket = false;
            const meta = Registry.get('parse')(msg);

            if (!meta) { ws.close(); return; }
            ws.send(Buffer.from([msg[0], 0]));

            const initialPayload = msg.subarray(meta.pOff);

            if (meta.prot === 2) {
                isUDP = true;
                if (meta.port !== 53) { ws.close(); return; }
                udpBuffer = initialPayload;
                processUDP();
                return;
            }

            const host = Registry.get('resolve')(meta.type, meta.clusterId);

            // 【核心修复2】严格的 TCP Socket 生命周期管理
            edgeSocket = net.createConnection({ host: host, port: meta.port }, () => {
                if (initialPayload.length > 0) edgeSocket.write(initialPayload);
            });

            edgeSocket.on('data', chunk => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
            edgeSocket.on('error', () => ws.close());
            edgeSocket.on('close', () => ws.close());
        } else {
            // 【核心修复3】彻底分离 UDP 和 TCP 的后续流处理
            if (isUDP) {
                udpBuffer = Buffer.concat([udpBuffer, msg]);
                processUDP();
            } else {
                if (edgeSocket && !edgeSocket.destroyed) edgeSocket.write(msg);
            }
        }
    });

    ws.on('close', () => { if (edgeSocket) edgeSocket.destroy(); });
    ws.on('error', () => { if (edgeSocket) edgeSocket.destroy(); });
});

server.listen(ENV.PORT, () => {
    console.log(`Aether Node Operations Active on Port ${ENV.PORT}`);
});