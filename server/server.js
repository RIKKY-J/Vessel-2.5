const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { parse } = require("url");
const express = require("express");
const cors = require("cors");
const httpProxy = require("http-proxy");
const { startSandbox, stopSandbox, getSandboxStatus, getSandboxPorts, getSandboxPortsAsync, shouldUseEcs, debugEcsTasks, getEcsLogs } = require("./src/orchestrator");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Enable CORS for Vercel frontend or any domain
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(express.json());

// ─── Standby HTML & TCP Health Check ─────────────────────────────────────────
function renderStandbyHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Waiting for App Server</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0D11; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #12151B; border: 1px solid #232936; border-radius: 14px; padding: 32px 24px; max-width: 440px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .spinner { width: 36px; height: 36px; border: 3px solid #232936; border-top-color: #E73F1E; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 18px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 17px; margin: 0 0 10px; color: #ffffff; font-weight: 600; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.6; margin: 0 0 18px; }
    .hint { background: #181C24; border: 1px solid #232936; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #cbd5e1; font-family: monospace; display: inline-block; }
    .btn-hint { color: #E73F1E; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Application Not Started Yet</h2>
    <p>Your web app isn't running on port 3000 yet.<br/>Click the <span class="btn-hint">Run ▶</span> button above, or type <span class="btn-hint">node index.js</span> in the terminal.</p>
    <div class="hint">Auto-refreshing every 2s until server listens...</div>
  </div>
  <script>setTimeout(function() { window.location.reload(); }, 2000);</script>
</body>
</html>`;
}

function checkTcpPort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(timeoutMs);
    const finish = (result) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(result);
      }
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

const portStatusCache = new Map();

async function isAppPortListening(replId, host, port) {
  const cached = portStatusCache.get(replId);
  const now = Date.now();
  if (cached && now - cached.timestamp < 1500) {
    return cached.isOpen;
  }
  const isOpen = await checkTcpPort(host, port, 1200);
  portStatusCache.set(replId, { isOpen, timestamp: now });
  return isOpen;
}

// ─── Proxy Setup ─────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

// Re-stream JSON body if express.json() consumed the request stream
proxy.on("proxyReq", (proxyReq, req) => {
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader("Content-Type", "application/json");
    proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
  }
});

proxy.on("error", (err, req, resOrSocket) => {
  console.warn("[Proxy] Connection warning:", err.message);
  if (resOrSocket && typeof resOrSocket.writeHead === "function" && !resOrSocket.headersSent) {
    try {
      const isPreview = (req && req._isPreview) || (req && req.url && req.url.includes("/api/preview/"));
      if (isPreview) {
        resOrSocket.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        resOrSocket.end(renderStandbyHtml());
      } else {
        resOrSocket.writeHead(502, { "Content-Type": "application/json" });
        resOrSocket.end(JSON.stringify({ error: "Runner offline or booting", message: err.message }));
      }
    } catch {}
  }
  if (resOrSocket && typeof resOrSocket.destroy === "function" && !resOrSocket.writeHead) {
    try { resOrSocket.destroy(); } catch {}
  }
});

// Helper to determine runner target URL (ECS task or local Docker host)
async function getRunnerTargetUrl(replId) {
  if (!replId) return null;
  const ports = await getSandboxPortsAsync(replId);
  if (ports?.containerIp) {
    return `http://${ports.containerIp}:${ports.runnerPort || 3001}`;
  }
  if (shouldUseEcs()) {
    return null;
  }
  return `http://127.0.0.1:${ports?.runnerPort || 3001}`;
}

// Helper to determine app preview target URL
async function getAppPreviewTargetInfo(replId) {
  if (!replId) return null;
  const ports = await getSandboxPortsAsync(replId);
  if (ports?.containerIp) {
    return {
      host: ports.containerIp,
      port: ports.appPort || 3000,
      url: `http://${ports.containerIp}:${ports.appPort || 3000}`,
    };
  }
  if (shouldUseEcs()) {
    return null;
  }
  return {
    host: "127.0.0.1",
    port: ports?.appPort || 3002,
    url: `http://127.0.0.1:${ports?.appPort || 3002}`,
  };
}

// ─── Health & Diagnostic Routes ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    provider: shouldUseEcs() ? "AWS ECS Fargate" : "Local Docker",
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/docker-status", (req, res) => {
  res.json({
    status: "ok",
    provider: shouldUseEcs() ? "ecs" : "docker",
    ecsConfigured: shouldUseEcs(),
  });
});

app.get("/api/ecs-debug", async (req, res) => {
  try {
    const data = await debugEcsTasks();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ecs-logs", async (req, res) => {
  try {
    const data = await getEcsLogs();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve self-contained, updated runner daemon bundle for dynamic container bootstrap
app.get("/api/runner-bundle.js", (req, res) => {
  const bundlePath = path.join(__dirname, "src", "runner-bundle.js");
  if (fs.existsSync(bundlePath)) {
    res.setHeader("Content-Type", "application/javascript");
    return res.sendFile(bundlePath);
  }
  res.status(404).send("// Bundle not found");
});

// ─── Sandbox Lifecycle REST APIs ─────────────────────────────────────────────
app.post("/api/projects/:replId/start", async (req, res) => {
  const { replId } = req.params;
  const { language = "node-js" } = req.body || {};
  try {
    const sandbox = await startSandbox({ replId, language });
    res.json({ success: true, sandbox, message: `Sandbox for ${replId} is running` });
  } catch (err) {
    console.error("[Server] Start sandbox error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:replId/status", async (req, res) => {
  const { replId } = req.params;
  try {
    const status = await getSandboxStatus(replId);
    const ports = await getSandboxPortsAsync(replId);
    const isReady = status.status === "RUNNING";
    const externalUrl = process.env.RENDER_EXTERNAL_URL || "https://vessel-backend-8i2e.onrender.com";
    res.json({
      status: status.status,
      ready: isReady,
      runnerPort: ports?.runnerPort || 3001,
      appPort: ports?.appPort || 3000,
      containerIp: ports?.containerIp,
      runnerWsUrl: externalUrl,
      error: status.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:replId/stop", async (req, res) => {
  const { replId } = req.params;
  try {
    await stopSandbox(replId);
    portStatusCache.delete(replId);
    res.json({ success: true, message: `Sandbox ${replId} stopped` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forward run command into runner container via direct HTTP
app.post("/api/projects/:replId/run", async (req, res) => {
  const { replId } = req.params;
  const { headless = true } = req.body || {};
  const targetUrl = await getRunnerTargetUrl(replId);
  if (!targetUrl) {
    return res.status(503).json({ error: "Sandbox is stopped. Please start the sandbox first." });
  }
  try {
    if (headless === false) {
      // Interactive run: kill any background process so port 3000 is 100% free for the terminal
      await fetch(`${targetUrl}/stop-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
      portStatusCache.delete(replId);
      return res.json({ success: true, mode: "interactive" });
    }

    const runRes = await fetch(`${targetUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(6000),
    });
    const data = await runRes.json().catch(() => ({}));
    // Clear preview port cache so next check immediately probes the freshly started app
    portStatusCache.delete(replId);
    return res.status(runRes.status).json(data);
  } catch (err) {
    console.error(`[Server] Error executing /run for ${replId}:`, err.message);
    return res.status(502).json({ error: err.message });
  }
});

// Forward sync files into runner container via direct HTTP
app.post("/api/projects/:replId/sync", async (req, res) => {
  const { replId } = req.params;
  const targetUrl = await getRunnerTargetUrl(replId);
  if (!targetUrl) {
    return res.status(503).json({ error: "Sandbox is stopped. Please start the sandbox first." });
  }
  try {
    const syncRes = await fetch(`${targetUrl}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(10000),
    });
    const data = await syncRes.json().catch(() => ({}));
    return res.status(syncRes.status).json(data);
  } catch (err) {
    console.error(`[Server] Error executing /sync for ${replId}:`, err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ─── Live Web Preview Reverse Proxy ──────────────────────────────────────────
app.all(["/api/preview/:replId", "/api/preview/:replId/*"], async (req, res) => {
  const { replId } = req.params;
  req._isPreview = true;

  const previewInfo = await getAppPreviewTargetInfo(replId);
  if (!previewInfo) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderStandbyHtml());
  }

  // Fast check: Is the user application actually listening on the port?
  const portOpen = await isAppPortListening(replId, previewInfo.host, previewInfo.port);
  if (!portOpen) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderStandbyHtml());
  }

  // Strip /api/preview/:replId prefix so the user app receives root request
  const prefix = `/api/preview/${replId}`;
  req.url = req.url.startsWith(prefix) ? req.url.slice(prefix.length) || "/" : req.url;

  proxy.web(req, res, {
    target: previewInfo.url,
    proxyTimeout: 8000,
    timeout: 8000,
  });
});

// ─── Socket.IO HTTP Long-Polling Reverse Proxy ───────────────────────────────
app.all(["/socket.io", "/socket.io/*"], async (req, res) => {
  const parsedUrl = parse(req.url, true);
  const replId = parsedUrl.query?.replId || req.query?.replId;
  const targetUrl = await getRunnerTargetUrl(replId);
  if (!targetUrl) {
    return res.status(503).json({ error: "Runner offline or stopped", replId });
  }
  proxy.web(req, res, { target: targetUrl });
});

// ─── Create HTTP Server & WebSocket Upgrade ──────────────────────────────────
const server = http.createServer(app);

// Proxy Socket.IO WebSocket upgrades
server.on("upgrade", async (req, socket, head) => {
  const parsedUrl = parse(req.url, true);
  if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io")) {
    const replId = parsedUrl.query?.replId;
    if (!replId) {
      socket.destroy();
      return;
    }
    const targetUrl = await getRunnerTargetUrl(replId);
    if (!targetUrl) {
      console.warn(`[Server] No active runner target for ${replId}, destroying upgrade socket`);
      socket.destroy();
      return;
    }
    console.log(`[Server] Proxying WebSocket upgrade for ${replId} ➔ ${targetUrl}`);
    proxy.ws(req, socket, head, { target: targetUrl });
    return;
  }
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`> Vessel Server listening on http://0.0.0.0:${PORT}`);
  console.log(`> Sandbox Provider: ${shouldUseEcs() ? "AWS ECS Fargate" : "Local Docker Engine"}`);
});
