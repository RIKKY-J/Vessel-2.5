const { createServer } = require("http");
const { parse } = require("url");
const fs = require("fs");
const path = require("path");
const net = require("net");
const next = require("next");
const httpProxy = require("http-proxy");

// Enforce production mode by default for PM2 / server deployment
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const dev = process.env.NODE_ENV === "development";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

// ─── Dynamic Runner Discovery (Local Port & Remote ECS Task IP) ───────────────
let cachedRunnerTarget = null;
let lastTargetCheck = 0;

function readTargetFromFile(replId) {
  try {
    const file = path.join(__dirname, "data", "active-sandboxes.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (replId && data[replId]) {
        return {
          host: data[replId].containerIp || data[replId].taskIp || "127.0.0.1",
          port: data[replId].runnerPort || 3001,
        };
      }
      const keys = Object.keys(data);
      if (keys.length > 0) {
        const last = data[keys[keys.length - 1]];
        if (last) {
          return {
            host: last.containerIp || last.taskIp || "127.0.0.1",
            port: last.runnerPort || 3001,
          };
        }
      }
    }
  } catch {}
  return null;
}

function probePort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, host);
  });
}

async function discoverRunnerTargetUrl(replId) {
  const now = Date.now();
  if (cachedRunnerTarget && now - lastTargetCheck < 3000) {
    return cachedRunnerTarget;
  }

  // Strategy 1: Read from active-sandboxes (handles both remote ECS IPs and local mapped ports)
  const fromFile = readTargetFromFile(replId);
  if (fromFile) {
    const targetUrl = `http://${fromFile.host}:${fromFile.port}`;
    cachedRunnerTarget = targetUrl;
    lastTargetCheck = now;
    return targetUrl;
  }

  // Strategy 2: Probe local ports for Docker/local runner
  const candidates = [3001, 3002, 3003, 3004, 3005, 40000, 40001, 40002];
  for (const port of candidates) {
    if (port === parseInt(process.env.PORT || "3000")) continue;
    const alive = await probePort(port, "127.0.0.1");
    if (alive) {
      const targetUrl = `http://127.0.0.1:${port}`;
      cachedRunnerTarget = targetUrl;
      lastTargetCheck = now;
      console.log(`[Proxy] Discovered active local runner on ${targetUrl}`);
      return targetUrl;
    }
  }

  return "http://127.0.0.1:3001";
}

async function discoverRunnerPort(replId) {
  const targetUrl = await discoverRunnerTargetUrl(replId);
  try {
    const u = new URL(targetUrl);
    return parseInt(u.port || "3001", 10);
  } catch {
    return 3001;
  }
}

function invalidatePortCache() {
  cachedRunnerTarget = null;
  lastTargetCheck = 0;
}

// ─── HTTP Proxy ──────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, resOrSocket) => {
  console.warn("[Proxy] Error:", err.message);
  invalidatePortCache();
  if (resOrSocket && typeof resOrSocket.writeHead === "function" && !resOrSocket.headersSent) {
    try {
      const isPreview = req && req.url && req.url.includes("/api/preview/");
      if (isPreview) {
        resOrSocket.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        resOrSocket.end(`
<!DOCTYPE html>
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
</html>`);
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

// ─── Direct Docker Diagnostics (Bypasses Next.js Compilation) ─────────────────
async function handleDockerStatus(req, res, parsedUrl) {
  res.setHeader("Content-Type", "application/json");
  try {
    const Docker = require("dockerode");
    const isWindows = process.platform === "win32";
    const docker = new Docker(
      process.env.DOCKER_HOST
        ? { host: process.env.DOCKER_HOST }
        : isWindows
        ? { socketPath: "//./pipe/docker_engine" }
        : { socketPath: "/var/run/docker.sock" }
    );

    // Optional cleanup action: /api/docker-status?action=cleanup
    if (parsedUrl.query?.action === "cleanup") {
      const all = await docker.listContainers({ all: true });
      let removedCount = 0;
      for (const c of all) {
        if (c.Names.some((n) => n.includes("vessel-"))) {
          try {
            const cont = docker.getContainer(c.Id);
            if (c.State === "running") await cont.stop({ t: 2 });
            await cont.remove({ force: true });
            removedCount++;
          } catch {}
        }
      }
      res.end(JSON.stringify({ success: true, message: `Removed ${removedCount} vessel containers` }));
      return;
    }

    await docker.ping();
    const rawContainers = await docker.listContainers({ all: true });
    const containers = await Promise.all(
      rawContainers.map(async (c) => {
        let logs = "";
        let inspectData = null;
        try {
          const cont = docker.getContainer(c.Id);
          inspectData = await cont.inspect();
          const logBuf = await cont.logs({ stdout: true, stderr: true, tail: 50 });
          logs = logBuf ? logBuf.toString("utf8") : "";
        } catch (e) {
          logs = `Logs error: ${e.message}`;
        }
        return {
          id: c.Id.substring(0, 12),
          names: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status,
          exitCode: inspectData?.State?.ExitCode,
          error: inspectData?.State?.Error,
          startedAt: inspectData?.State?.StartedAt,
          finishedAt: inspectData?.State?.FinishedAt,
          ports: c.Ports,
          logs,
        };
      })
    );

    let activeSandboxes = {};
    try {
      const p = path.join(__dirname, "data", "active-sandboxes.json");
      if (fs.existsSync(p)) activeSandboxes = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}

    res.end(
      JSON.stringify(
        {
          dockerAvailable: true,
          containers,
          activeSandboxes,
          serverPort: process.env.PORT || "3000",
        },
        null,
        2
      )
    );
  } catch (err) {
    res.end(JSON.stringify({ dockerAvailable: false, error: err.message }, null, 2));
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const requestHandler = async (req, res) => {
    const parsedUrl = parse(req.url, true);

    // Set permissive CORS headers for Render backend when serving requests from Vercel
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Direct Docker diagnostic endpoint in server.js (instant, no build needed)
    if (parsedUrl.pathname === "/api/docker-status") {
      return handleDockerStatus(req, res, parsedUrl);
    }

    // Proxy Socket.IO HTTP long-polling to active runner container (Local Port or Remote ECS IP)
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
      const replId = parsedUrl.query?.replId;
      const targetUrl = await discoverRunnerTargetUrl(replId);
      proxy.web(req, res, { target: targetUrl });
      return;
    }

    // Default Next.js handler
    handle(req, res, parsedUrl);
  };

  const server = createServer(requestHandler);

  // Proxy WebSocket upgrade requests
  server.on("upgrade", async (req, socket, head) => {
    const parsedUrl = parse(req.url, true);
    const { pathname, query } = parsedUrl;

    if (pathname && pathname.startsWith("/socket.io/")) {
      const replId = query?.replId;
      const targetUrl = await discoverRunnerTargetUrl(replId);
      console.log(`[Proxy] WS upgrade for replId=${replId} → ${targetUrl}`);
      proxy.ws(req, socket, head, { target: targetUrl });
      return;
    }

    // Allow Next.js dev HMR
    if (dev && typeof app.getUpgradeHandler === "function") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    socket.destroy();
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", (err) => {
    if (err) throw err;
    console.log(`> Vessel unified server (${dev ? "dev" : "production"}) on http://0.0.0.0:${port}`);
  });
});
