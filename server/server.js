const http = require("http");
const { parse } = require("url");
const express = require("express");
const cors = require("cors");
const httpProxy = require("http-proxy");
const { startSandbox, stopSandbox, getSandboxStatus, getSandboxPorts, shouldUseEcs } = require("./src/orchestrator");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Enable CORS for Vercel frontend or any domain
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(express.json());

// ─── Proxy Setup ─────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, resOrSocket) => {
  console.warn("[Proxy] Connection warning:", err.message);
  if (resOrSocket && typeof resOrSocket.writeHead === "function" && !resOrSocket.headersSent) {
    try {
      resOrSocket.writeHead(502, { "Content-Type": "application/json" });
      resOrSocket.end(JSON.stringify({ error: "Runner offline or booting", message: err.message }));
    } catch {}
  }
  if (resOrSocket && typeof resOrSocket.destroy === "function" && !resOrSocket.writeHead) {
    try { resOrSocket.destroy(); } catch {}
  }
});

// Helper to determine runner target URL (ECS task or local Docker host)
function getRunnerTargetUrl(replId) {
  const ports = getSandboxPorts(replId);
  if (ports?.containerIp) {
    return `http://${ports.containerIp}:${ports.runnerPort || 3001}`;
  }
  return `http://127.0.0.1:${ports?.runnerPort || 3001}`;
}

// Helper to determine app preview target URL
function getAppPreviewTargetUrl(replId) {
  const ports = getSandboxPorts(replId);
  if (ports?.containerIp) {
    return `http://${ports.containerIp}:${ports.appPort || 3000}`;
  }
  return `http://127.0.0.1:${ports?.appPort || 3002}`;
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
    const ports = getSandboxPorts(replId);
    const isReady = status.status === "RUNNING";
    res.json({
      status: status.status,
      ready: isReady,
      runnerPort: ports?.runnerPort || 3001,
      appPort: ports?.appPort || 3000,
      containerIp: ports?.containerIp,
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
    res.json({ success: true, message: `Sandbox ${replId} stopped` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forward run command into runner container
app.post("/api/projects/:replId/run", async (req, res) => {
  const { replId } = req.params;
  const targetUrl = getRunnerTargetUrl(replId);
  proxy.web(req, res, { target: targetUrl });
});

// Forward sync files into runner container
app.post("/api/projects/:replId/sync", async (req, res) => {
  const { replId } = req.params;
  const targetUrl = getRunnerTargetUrl(replId);
  proxy.web(req, res, { target: targetUrl });
});

// ─── Live Web Preview Reverse Proxy ──────────────────────────────────────────
app.all(["/api/preview/:replId", "/api/preview/:replId/*"], (req, res) => {
  const { replId } = req.params;
  const targetUrl = getAppPreviewTargetUrl(replId);
  // Strip /api/preview/:replId prefix so the user app receives root request
  const prefix = `/api/preview/${replId}`;
  req.url = req.url.startsWith(prefix) ? req.url.slice(prefix.length) || "/" : req.url;
  proxy.web(req, res, { target: targetUrl });
});

// ─── Create HTTP Server & WebSocket Upgrade ──────────────────────────────────
const server = http.createServer(app);

// Proxy Socket.IO HTTP long-polling and WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  const parsedUrl = parse(req.url, true);
  if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
    const replId = parsedUrl.query?.replId;
    const targetUrl = getRunnerTargetUrl(replId);
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
