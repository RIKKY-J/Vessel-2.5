import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { saveToS3, fetchS3Folder, saveFolderToS3 } from "./aws";
import path from "path";
import { fetchDir, fetchFileContent, saveFile, seedWorkspaceFiles } from "./fs";
import { TerminalManager } from "./pty";

const terminalManager = new TerminalManager();

export function initWs(httpServer: HttpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });
      
    io.on("connection", async (socket) => {
        try {
            const host = socket.handshake.headers.host;
            console.log(`[WS] New connection: socket.id=${socket.id}, host=${host}, transport=${socket.conn.transport.name}`);
            
            const replId =
                (socket.handshake.query?.replId as string) ||
                (socket.handshake.auth?.replId as string) ||
                process.env.REPL_ID ||
                host?.split('.')[0];
        
            if (!replId) {
                console.log("[WS] No replId found, disconnecting");
                socket.disconnect();
                terminalManager.clear(socket.id);
                return;
            }

            console.log(`[WS] replId=${replId}, checking /workspace`);
            let rootContent = await fetchDir("/workspace", "");

            // If workspace is empty, fetch files from S3 code folder as fallback
            if (!rootContent || rootContent.length === 0) {
                console.log(`[WS] /workspace is empty. Attempting S3 fallback fetch for replId=${replId}...`);
                try {
                    await fetchS3Folder(`code/${replId}`, "/workspace");
                    rootContent = await fetchDir("/workspace", "");
                    console.log(`[WS] Fallback fetch complete. Files found: ${rootContent.length}`);
                } catch (err) {
                    console.error("[WS] Fallback S3 fetch error:", err);
                }

                // If still empty after S3 check, guarantee boilerplate starter files exist
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

function initHandlers(socket: Socket, replId: string) {

    socket.on("disconnect", () => {
        console.log(`[WS] User disconnected: socket.id=${socket.id}`);
        terminalManager.clear(socket.id);
    });

    socket.on("fetchDir", async (dir: string, callback) => {
        try {
            const dirPath = `/workspace/${dir}`;
            const contents = await fetchDir(dirPath, dir);
            if (typeof callback === "function") callback(contents);
        } catch (err) {
            console.warn("[WS] fetchDir error:", err);
            if (typeof callback === "function") callback([]);
        }
    });

    socket.on("fetchContent", async ({ path: filePath }: { path: string }, callback) => {
        try {
            const fullPath = `/workspace/${filePath}`;
            const data = await fetchFileContent(fullPath);
            if (typeof callback === "function") callback(data);
        } catch (err) {
            console.warn("[WS] fetchContent error:", err);
            if (typeof callback === "function") callback("");
        }
    });

    socket.on("updateContent", async ({ path: filePath, content }: { path: string, content: string }) => {
        try {
            const fullPath = `/workspace/${filePath}`;
            await saveFile(fullPath, content);
            await saveToS3(`code/${replId}`, filePath, content);
            // Broadcast live file changes to all other connected client tabs/collaborators
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
                socket.emit('terminal', {
                    data: buf
                });
            });
        } catch (err) {
            console.error("[WS] requestTerminal error:", err);
        }
    });
    
    socket.on("terminalData", async ({ data }: { data: string, terminalId?: number }) => {
        try {
            terminalManager.write(socket.id, data);
        } catch (err) {
            console.warn("[WS] terminalData error:", err);
        }
    });

    socket.on("terminalResize", ({ cols, rows }: { cols: number, rows: number }) => {
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
        } catch (err: any) {
            console.error("[WS] saveAll error:", err);
            if (typeof callback === "function") callback({ success: false, error: err?.message });
        }
    });

}