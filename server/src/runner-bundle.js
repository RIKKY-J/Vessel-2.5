"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// sandbox/src/index.ts
var import_dotenv = __toESM(require("dotenv"));
var import_fs5 = __toESM(require("fs"));
var import_express = __toESM(require("express"));
var import_http = require("http");

// sandbox/src/ws.ts
var import_socket = require("socket.io");

// sandbox/src/aws.ts
var import_aws_sdk = require("aws-sdk");
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var s3 = new import_aws_sdk.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: true
});
var fetchS3Folder = async (key, localPath) => {
  const cleanKey = key.replace(/\/+$/, "");
  const params = {
    Bucket: process.env.S3_BUCKET ?? "",
    Prefix: cleanKey
  };
  const response = await s3.listObjectsV2(params).promise();
  if (response.Contents && response.Contents.length > 0) {
    for (const file of response.Contents) {
      const fileKey = file.Key;
      if (fileKey) {
        const relPath = fileKey.slice(cleanKey.length).replace(/^\/+/, "");
        if (!relPath) continue;
        const filePath = import_path.default.join(localPath, relPath);
        const getParams = {
          Bucket: process.env.S3_BUCKET ?? "",
          Key: fileKey
        };
        const data = await s3.getObject(getParams).promise();
        if (data.Body) {
          await writeFile(filePath, data.Body);
        }
      }
    }
  }
};
function writeFile(filePath, fileData) {
  return new Promise(async (resolve, reject) => {
    await createFolder(import_path.default.dirname(filePath));
    import_fs.default.writeFile(filePath, fileData, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
function createFolder(dirName) {
  return new Promise((resolve, reject) => {
    import_fs.default.mkdir(dirName, { recursive: true }, (err) => {
      if (err) {
        return reject(err);
      }
      resolve();
    });
  });
}
var saveToS3 = async (key, filePath, content) => {
  const cleanKey = key.replace(/\/+$/, "");
  const cleanPath = filePath.replace(/^\/+/, "");
  const params = {
    Bucket: process.env.S3_BUCKET ?? "",
    Key: `${cleanKey}/${cleanPath}`,
    Body: content
  };
  await s3.putObject(params).promise();
};
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".cache",
  ".next",
  "__pycache__",
  ".venv",
  "venv"
]);
var saveFolderToS3 = async (localDir, s3Prefix) => {
  const cleanPrefix = s3Prefix.replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET ?? "";
  async function scanAndUpload(currentDir, relPath = "") {
    if (!import_fs.default.existsSync(currentDir)) return;
    const entries = await import_fs.default.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const fullPath = import_path.default.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await scanAndUpload(fullPath, entryRel);
      } else if (entry.isFile()) {
        try {
          const fileData = await import_fs.default.promises.readFile(fullPath);
          const s3Key = `${cleanPrefix}/${entryRel}`;
          await s3.putObject({
            Bucket: bucket,
            Key: s3Key,
            Body: fileData
          }).promise();
          console.log(`[S3 Sync] Uploaded ${entryRel} -> ${s3Key}`);
        } catch (fileErr) {
          console.warn(`[S3 Sync] Failed to upload ${entryRel}:`, fileErr);
        }
      }
    }
  }
  console.log(`[S3 Sync] Starting full sync of ${localDir} to s3://${bucket}/${cleanPrefix}...`);
  await scanAndUpload(localDir);
  console.log(`[S3 Sync] Full sync of ${localDir} completed.`);
};

// sandbox/src/fs.ts
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
function seedWorkspaceFiles(language = "node-js") {
  try {
    if (!import_fs2.default.existsSync("/workspace")) {
      import_fs2.default.mkdirSync("/workspace", { recursive: true });
    }
    const entries = import_fs2.default.readdirSync("/workspace").filter((f) => f !== "node_modules" && f !== ".git");
    if (entries.length > 0) return;
    console.log(`[fs] Seeding starter files for language: ${language}`);
    if (language === "python") {
      const pyContent = `from http.server import HTTPServer, BaseHTTPRequestHandler
import sys

PORT = 3000

class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.end_headers()
        html = """
        <!DOCTYPE html>
        <html>
          <head>
            <title>Vessel Python App</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #0B0D11;
                color: #FFFFFF;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              .card {
                background: #12151B;
                border: 1px solid #232936;
                padding: 2.5rem;
                border-radius: 12px;
                text-align: center;
              }
              h1 { color: #E73F1E; }
              p { color: #94A3B8; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>\u{1F40D} Vessel Python Server Live!</h1>
              <p>Your Python HTTP server is serving requests on port 3000.</p>
            </div>
          </body>
        </html>
        """
        self.wfile.write(html.encode('utf-8'))

if __name__ == '__main__':
    print(f"[Python] Server started on port {PORT}")
    server = HTTPServer(('0.0.0.0', PORT), SimpleHandler)
    server.serve_forever()
`;
      import_fs2.default.writeFileSync("/workspace/main.py", pyContent, "utf8");
    } else {
      const jsContent = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send(\`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Vessel App</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0B0D11;
            color: #FFFFFF;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background: #12151B;
            border: 1px solid #232936;
            padding: 2.5rem;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          }
          h1 { color: #E73F1E; margin-bottom: 0.5rem; }
          p { color: #94A3B8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>\u{1F680} Vessel Container is Live!</h1>
          <p>Your Node.js web application is running on port \${port}.</p>
          <p>Edit <code>index.js</code> and watch it auto-reload!</p>
        </div>
      </body>
    </html>
  \`);
});

app.listen(port, () => {
  console.log(\`[Server] Web application running at http://localhost:\${port}\`);
});
`;
      const pkgContent = JSON.stringify(
        {
          name: "vessel-nodejs-sandbox",
          version: "1.0.0",
          main: "index.js",
          scripts: {
            start: "node --watch index.js",
            dev: "node --watch index.js"
          },
          dependencies: {
            express: "^4.18.2",
            cors: "^2.8.5"
          }
        },
        null,
        2
      );
      import_fs2.default.writeFileSync("/workspace/index.js", jsContent, "utf8");
      import_fs2.default.writeFileSync("/workspace/package.json", pkgContent, "utf8");
    }
    console.log("[fs] Starter files successfully seeded in /workspace");
  } catch (err) {
    console.warn("[fs] seedWorkspaceFiles warning:", err?.message || err);
  }
}
var fetchDir = (dir, baseDir) => {
  return new Promise((resolve) => {
    if (!import_fs2.default.existsSync(dir)) {
      try {
        import_fs2.default.mkdirSync(dir, { recursive: true });
      } catch {
      }
      return resolve([]);
    }
    import_fs2.default.readdir(dir, { withFileTypes: true }, (err, files) => {
      if (err) {
        console.warn(`[fs] fetchDir warning for ${dir}:`, err.message);
        return resolve([]);
      }
      resolve(
        files.filter((file) => file.name !== "node_modules" && file.name !== ".git" && file.name !== ".cache").map((file) => ({
          type: file.isDirectory() ? "dir" : "file",
          name: file.name,
          path: `${baseDir ? baseDir + "/" : ""}${file.name}`
        }))
      );
    });
  });
};
var fetchFileContent = (file) => {
  return new Promise((resolve) => {
    if (!import_fs2.default.existsSync(file)) {
      return resolve("");
    }
    import_fs2.default.readFile(file, "utf8", (err, data) => {
      if (err) {
        console.warn(`[fs] fetchFileContent warning for ${file}:`, err.message);
        return resolve("");
      }
      resolve(data);
    });
  });
};
var saveFile = async (file, content) => {
  return new Promise((resolve, reject) => {
    const dir = import_path2.default.dirname(file);
    if (!import_fs2.default.existsSync(dir)) {
      try {
        import_fs2.default.mkdirSync(dir, { recursive: true });
      } catch {
      }
    }
    import_fs2.default.writeFile(file, content, "utf8", (err) => {
      if (err) {
        console.warn(`[fs] saveFile warning for ${file}:`, err.message);
        return reject(err);
      }
      resolve();
    });
  });
};

// sandbox/src/pty.ts
var import_fs3 = __toESM(require("fs"));
var import_child_process = require("child_process");
var ptyModule = null;
try {
  ptyModule = require("node-pty");
  console.log("[PTY] node-pty loaded successfully");
} catch (err) {
  console.warn("[PTY] node-pty native addon not available, using child_process fallback:", err?.message || err);
}
var SHELL = import_fs3.default.existsSync("/bin/bash") ? "/bin/bash" : import_fs3.default.existsSync("/bin/sh") ? "/bin/sh" : "bash";
var TerminalManager = class {
  constructor() {
    this.sessions = {};
    this.sessions = {};
  }
  createPty(id, replId, onData, cols = 100, rows = 24) {
    if (this.sessions[id]) {
      console.log(`[PTY] Killing existing PTY for socket ${id} before creating new one`);
      this.clear(id);
    }
    const workspaceDir = import_fs3.default.existsSync("/workspace") ? "/workspace" : process.cwd();
    if (ptyModule) {
      try {
        const spawnPty = ptyModule.spawn || ptyModule.fork;
        if (typeof spawnPty === "function") {
          console.log(`[PTY] Creating native PTY (${cols}x${rows}) for socket ${id}, replId=${replId}`);
          const term = spawnPty(SHELL, [], {
            cols: cols || 100,
            rows: rows || 24,
            name: "xterm-256color",
            cwd: workspaceDir,
            env: {
              ...process.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
              SHELL,
              NODE_PATH: process.env.NODE_PATH || "/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules",
              PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            }
          });
          const termPid = term.pid || Math.floor(Math.random() * 1e4);
          console.log(`[PTY] Native PTY created with pid=${termPid}`);
          const termAny = term;
          if (typeof termAny.onData === "function") {
            termAny.onData((data) => onData(data, termPid));
          } else if (typeof termAny.on === "function") {
            termAny.on("data", (data) => onData(data, termPid));
          }
          const handleExit = (code) => {
            console.log(`[PTY] Native PTY exited for socket ${id}, pid=${termPid}, code=${code}`);
            delete this.sessions[id];
          };
          if (typeof termAny.onExit === "function") {
            termAny.onExit((ev) => handleExit(typeof ev === "object" ? ev?.exitCode : ev));
          } else if (typeof termAny.on === "function") {
            termAny.on("exit", handleExit);
          }
          this.sessions[id] = { terminal: term, replId, isNative: true };
          return term;
        }
      } catch (err) {
        console.warn("[PTY] Native PTY spawn error, falling back to child_process:", err?.message || err);
      }
    }
    console.log(`[PTY] Spawning fallback shell process (${SHELL}) for socket ${id}, replId=${replId}`);
    const child = (0, import_child_process.spawn)(SHELL, ["-i"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        SHELL,
        NODE_PATH: process.env.NODE_PATH || "/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules",
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const childPid = child.pid || 1;
    child.stdout?.on("data", (chunk) => {
      onData(chunk.toString("utf8"), childPid);
    });
    child.stderr?.on("data", (chunk) => {
      onData(chunk.toString("utf8"), childPid);
    });
    child.on("exit", (code) => {
      console.log(`[PTY] Fallback shell exited for socket ${id}, pid=${childPid}, code=${code}`);
      delete this.sessions[id];
    });
    this.sessions[id] = { terminal: child, replId, isNative: false };
    return child;
  }
  write(terminalId, data) {
    const session = this.sessions[terminalId];
    if (!session) {
      console.warn(`[PTY] write: No session found for terminalId=${terminalId}.`);
      return;
    }
    try {
      if (session.isNative && typeof session.terminal?.write === "function") {
        session.terminal.write(data);
      } else if (session.terminal?.stdin && typeof session.terminal.stdin.write === "function") {
        session.terminal.stdin.write(data);
      }
    } catch (err) {
      console.warn("[PTY] write error:", err?.message || err);
    }
  }
  resize(terminalId, cols, rows) {
    const session = this.sessions[terminalId];
    if (session && session.isNative && typeof session.terminal?.resize === "function") {
      try {
        session.terminal.resize(cols, rows);
      } catch (e) {
        console.warn("[PTY] resize error:", e?.message || e);
      }
    }
  }
  clear(terminalId) {
    const session = this.sessions[terminalId];
    if (session) {
      try {
        if (session.isNative && typeof session.terminal?.kill === "function") {
          session.terminal.kill();
        } else if (session.terminal && typeof session.terminal.kill === "function") {
          session.terminal.kill("SIGTERM");
        }
      } catch (e) {
        console.warn("[PTY] clear error:", e?.message || e);
      }
      delete this.sessions[terminalId];
    }
  }
};

// sandbox/src/ws.ts
var terminalManager = new TerminalManager();
function initWs(httpServer2) {
  const io = new import_socket.Server(httpServer2, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  io.on("connection", async (socket) => {
    try {
      const host = socket.handshake.headers.host;
      console.log(`[WS] New connection: socket.id=${socket.id}, host=${host}, transport=${socket.conn.transport.name}`);
      const replId = socket.handshake.query?.replId || socket.handshake.auth?.replId || process.env.REPL_ID || host?.split(".")[0];
      if (!replId) {
        console.log("[WS] No replId found, disconnecting");
        socket.disconnect();
        terminalManager.clear(socket.id);
        return;
      }
      console.log(`[WS] replId=${replId}, checking /workspace`);
      let rootContent = await fetchDir("/workspace", "");
      if (!rootContent || rootContent.length === 0) {
        console.log(`[WS] /workspace is empty. Attempting S3 fallback fetch for replId=${replId}...`);
        try {
          await fetchS3Folder(`code/${replId}`, "/workspace");
          rootContent = await fetchDir("/workspace", "");
          console.log(`[WS] Fallback fetch complete. Files found: ${rootContent.length}`);
        } catch (err) {
          console.error("[WS] Fallback S3 fetch error:", err);
        }
        if (!rootContent || rootContent.length === 0) {
          console.log(`[WS] Workspace still empty. Generating default boilerplate files.`);
          seedWorkspaceFiles(process.env.LANGUAGE || "node-js");
          rootContent = await fetchDir("/workspace", "");
        }
      }
      socket.emit("loaded", {
        rootContent: rootContent || []
      });
      initHandlers(socket, replId);
    } catch (connErr) {
      console.error("[WS] Connection initialization error:", connErr);
    }
  });
}
function initHandlers(socket, replId) {
  socket.on("disconnect", () => {
    console.log(`[WS] User disconnected: socket.id=${socket.id}`);
    terminalManager.clear(socket.id);
  });
  socket.on("fetchDir", async (dir, callback) => {
    try {
      const dirPath = `/workspace/${dir}`;
      const contents = await fetchDir(dirPath, dir);
      if (typeof callback === "function") callback(contents);
    } catch (err) {
      console.warn("[WS] fetchDir error:", err);
      if (typeof callback === "function") callback([]);
    }
  });
  socket.on("fetchContent", async ({ path: filePath }, callback) => {
    try {
      const fullPath = `/workspace/${filePath}`;
      const data = await fetchFileContent(fullPath);
      if (typeof callback === "function") callback(data);
    } catch (err) {
      console.warn("[WS] fetchContent error:", err);
      if (typeof callback === "function") callback("");
    }
  });
  socket.on("updateContent", async ({ path: filePath, content }) => {
    try {
      const fullPath = `/workspace/${filePath}`;
      await saveFile(fullPath, content);
      await saveToS3(`code/${replId}`, filePath, content);
      socket.broadcast.emit("fileUpdated", { path: filePath, content });
    } catch (err) {
      console.warn("[WS] updateContent error:", err);
    }
  });
  socket.on("requestTerminal", async () => {
    console.log(`[WS] requestTerminal from socket.id=${socket.id}`);
    try {
      terminalManager.createPty(socket.id, replId, (data, id) => {
        const buf = Buffer.from(data, "utf-8");
        socket.emit("terminal", {
          data: buf
        });
      });
    } catch (err) {
      console.error("[WS] requestTerminal error:", err);
    }
  });
  socket.on("terminalData", async ({ data }) => {
    try {
      terminalManager.write(socket.id, data);
    } catch (err) {
      console.warn("[WS] terminalData error:", err);
    }
  });
  socket.on("terminalResize", ({ cols, rows }) => {
    try {
      terminalManager.resize(socket.id, cols, rows);
    } catch (err) {
      console.warn("[WS] terminalResize error:", err);
    }
  });
  socket.on("saveAll", async (callback) => {
    console.log(`[WS] saveAll requested from client socket.id=${socket.id} for replId=${replId}`);
    try {
      await saveFolderToS3("/workspace", `code/${replId}`);
      if (typeof callback === "function") callback({ success: true });
    } catch (err) {
      console.error("[WS] saveAll error:", err);
      if (typeof callback === "function") callback({ success: false, error: err?.message });
    }
  });
}

// sandbox/src/index.ts
var import_cors = __toESM(require("cors"));

// sandbox/src/process.ts
var import_child_process2 = require("child_process");
var activeProcess = null;
function runUserProcess(command) {
  if (activeProcess) {
    try {
      console.log(`[Process] Terminating previous process PID: ${activeProcess.pid}`);
      activeProcess.kill("SIGTERM");
    } catch (err) {
      console.warn("[Process] Error terminating previous process:", err);
    }
    activeProcess = null;
  }
  console.log(`[Process] Executing in /workspace: "${command}"`);
  const child = (0, import_child_process2.spawn)(command, {
    cwd: "/workspace",
    shell: true,
    env: {
      ...process.env,
      PORT: "3000",
      NODE_PATH: "/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout?.on("data", (data) => {
    console.log(`[App:stdout] ${data.toString()}`);
  });
  child.stderr?.on("data", (data) => {
    console.warn(`[App:stderr] ${data.toString()}`);
  });
  child.on("exit", (code, signal) => {
    console.log(`[App] Exited with code=${code}, signal=${signal}`);
    if (activeProcess === child) {
      activeProcess = null;
    }
  });
  activeProcess = child;
  return { pid: child.pid, command };
}

// sandbox/src/index.ts
import_dotenv.default.config();
process.on("uncaughtException", (err) => {
  console.error("[Runner] FATAL Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Runner] Unhandled Rejection at:", promise, "reason:", reason);
});
seedWorkspaceFiles(process.env.LANGUAGE || "node-js");
var app = (0, import_express.default)();
app.use((0, import_cors.default)());
app.use(import_express.default.json());
var httpServer = (0, import_http.createServer)(app);
app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    uptime: process.uptime(),
    replId: process.env.REPL_ID || null,
    workspaceExists: import_fs5.default.existsSync("/workspace")
  });
});
app.post("/sync", async (req, res) => {
  const replId = req.body?.replId || process.env.REPL_ID;
  if (!replId) {
    return res.status(400).json({ error: "replId is required" });
  }
  try {
    await saveFolderToS3("/workspace", `code/${replId}`);
    return res.json({ success: true, message: `Synced /workspace to code/${replId}` });
  } catch (err) {
    return res.status(500).json({ error: err?.message });
  }
});
app.post("/run", async (req, res) => {
  const { command } = req.body;
  const result = runUserProcess(command || "node --watch index.js");
  return res.json({ success: true, ...result });
});
initWs(httpServer);
var port = process.env.PORT || 3001;
httpServer.listen(port, () => {
  console.log(`[Runner] Daemon listening on port ${port}`);
});
var handleGracefulShutdown = async (signal) => {
  console.log(`[Runner] Received ${signal}. Starting graceful shutdown...`);
  const replId = process.env.REPL_ID;
  if (replId) {
    try {
      console.log(`[Runner] Persisting /workspace to S3 code/${replId}...`);
      await saveFolderToS3("/workspace", `code/${replId}`);
      console.log(`[Runner] Workspace successfully persisted to S3.`);
    } catch (err) {
      console.error("[Runner] Error persisting workspace on shutdown:", err);
    }
  }
  process.exit(0);
};
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
