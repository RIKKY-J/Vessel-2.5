import fs from "fs";
import { spawn as cpSpawn } from "child_process";

let ptyModule: any = null;
try {
    ptyModule = require("node-pty");
    console.log("[PTY] node-pty loaded successfully");
} catch (err: any) {
    console.warn("[PTY] node-pty native addon not available, using child_process fallback:", err?.message || err);
}

const SHELL = fs.existsSync("/bin/bash") ? "/bin/bash" : fs.existsSync("/bin/sh") ? "/bin/sh" : "bash";

interface PTYSession {
    terminal: any;
    replId: string;
    isNative: boolean;
}

export class TerminalManager {
    private sessions: { [id: string]: PTYSession } = {};

    constructor() {
        this.sessions = {};
    }
    
    createPty(id: string, replId: string, onData: (data: string, id: number) => void, cols: number = 100, rows: number = 24) {
        // Kill existing PTY for this socket ID if one exists
        if (this.sessions[id]) {
            console.log(`[PTY] Killing existing PTY for socket ${id} before creating new one`);
            this.clear(id);
        }

        const workspaceDir = fs.existsSync("/workspace") ? "/workspace" : process.cwd();

        // Strategy 1: Attempt native node-pty
        if (ptyModule) {
            try {
                const spawnPty = ptyModule.spawn || ptyModule.fork;
                if (typeof spawnPty === "function") {
                    console.log(`[PTY] Creating native PTY (${cols}x${rows}) for socket ${id}, replId=${replId}`);
                    const term = spawnPty(SHELL, [], {
                        cols: cols || 100,
                        rows: rows || 24,
                        name: 'xterm-256color',
                        cwd: workspaceDir,
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            SHELL: SHELL,
                            NODE_PATH: process.env.NODE_PATH || '/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules',
                            PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                        },
                    });

                    const termPid = term.pid || Math.floor(Math.random() * 10000);
                    console.log(`[PTY] Native PTY created with pid=${termPid}`);

                    const termAny = term as any;
                    if (typeof termAny.onData === 'function') {
                        termAny.onData((data: string) => onData(data, termPid));
                    } else if (typeof termAny.on === 'function') {
                        termAny.on('data', (data: string) => onData(data, termPid));
                    }

                    const handleExit = (code: any) => {
                        console.log(`[PTY] Native PTY exited for socket ${id}, pid=${termPid}, code=${code}`);
                        delete this.sessions[id];
                    };

                    if (typeof termAny.onExit === 'function') {
                        termAny.onExit((ev: any) => handleExit(typeof ev === 'object' ? ev?.exitCode : ev));
                    } else if (typeof termAny.on === 'function') {
                        termAny.on('exit', handleExit);
                    }

                    this.sessions[id] = { terminal: term, replId, isNative: true };
                    return term;
                }
            } catch (err: any) {
                console.warn("[PTY] Native PTY spawn error, falling back to child_process:", err?.message || err);
            }
        }

        // Strategy 2: Fallback to interactive bash/sh via child_process
        console.log(`[PTY] Spawning fallback shell process (${SHELL}) for socket ${id}, replId=${replId}`);
        const child = cpSpawn(SHELL, ["-i"], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                SHELL: SHELL,
                NODE_PATH: process.env.NODE_PATH || '/code/node_modules:/usr/local/lib/node_modules:/workspace/node_modules',
                PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            },
            stdio: ["pipe", "pipe", "pipe"],
        });

        const childPid = child.pid || 1;
        child.stdout?.on("data", (chunk: Buffer) => {
            onData(chunk.toString("utf8"), childPid);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            onData(chunk.toString("utf8"), childPid);
        });
        child.on("exit", (code) => {
            console.log(`[PTY] Fallback shell exited for socket ${id}, pid=${childPid}, code=${code}`);
            delete this.sessions[id];
        });

        this.sessions[id] = { terminal: child, replId, isNative: false };
        return child;
    }

    write(terminalId: string, data: string) {
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
        } catch (err: any) {
            console.warn("[PTY] write error:", err?.message || err);
        }
    }

    resize(terminalId: string, cols: number, rows: number) {
        const session = this.sessions[terminalId];
        if (session && session.isNative && typeof session.terminal?.resize === "function") {
            try {
                session.terminal.resize(cols, rows);
            } catch (e: any) {
                console.warn("[PTY] resize error:", e?.message || e);
            }
        }
    }

    clear(terminalId: string) {
        const session = this.sessions[terminalId];
        if (session) {
            try {
                if (session.isNative && typeof session.terminal?.kill === "function") {
                    session.terminal.kill();
                } else if (session.terminal && typeof session.terminal.kill === "function") {
                    session.terminal.kill("SIGTERM");
                }
            } catch (e: any) {
                console.warn("[PTY] clear error:", e?.message || e);
            }
            delete this.sessions[terminalId];
        }
    }
}
