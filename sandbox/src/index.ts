import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import express from "express";
import { createServer } from "http";
import { initWs } from "./ws";
import cors from "cors";
import { saveFolderToS3 } from "./aws";
import { runUserProcess } from "./process";

// Prevent container crash on unhandled errors
process.on("uncaughtException", (err) => {
  console.error("[Runner] FATAL Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Runner] Unhandled Rejection at:", promise, "reason:", reason);
});

// Ensure /workspace exists and has starter files
import { seedWorkspaceFiles } from "./fs";
seedWorkspaceFiles(process.env.LANGUAGE || "node-js");

const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);

// Runner health check endpoint
app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    uptime: process.uptime(),
    replId: process.env.REPL_ID || null,
    workspaceExists: fs.existsSync("/workspace"),
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
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

app.post("/run", async (req, res) => {
  const { command } = req.body;
  const result = runUserProcess(command || "node --watch index.js");
  return res.json({ success: true, ...result });
});

initWs(httpServer);

const port = process.env.PORT || 3001;
httpServer.listen(port, () => {
  console.log(`[Runner] Daemon listening on port ${port}`);
});

const handleGracefulShutdown = async (signal: string) => {
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