"use client";

import React, { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { Terminal as TerminalIcon, Copy, Check } from "lucide-react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";

interface TerminalProps {
  socket: Socket | null;
  replId: string;
}

function decodeData(buf: any): string {
  if (typeof buf === "string") return buf;
  if (!buf) return "";

  if (buf instanceof ArrayBuffer) {
    try {
      return new TextDecoder("utf-8").decode(new Uint8Array(buf));
    } catch {
      return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
    }
  }

  if (buf instanceof Uint8Array || ArrayBuffer.isView(buf)) {
    try {
      return new TextDecoder("utf-8").decode(buf);
    } catch {
      return String.fromCharCode.apply(null, Array.from(buf as any));
    }
  }

  if (typeof buf === "object") {
    if (buf.data instanceof ArrayBuffer) return decodeData(buf.data);
    if (buf.data instanceof Uint8Array || ArrayBuffer.isView(buf.data)) return decodeData(buf.data);
    if (Array.isArray(buf.data)) {
      try {
        return new TextDecoder("utf-8").decode(new Uint8Array(buf.data));
      } catch {
        return String.fromCharCode.apply(null, buf.data);
      }
    }
    if (typeof (buf as any).toString === "function" && buf.constructor?.name === "Buffer") {
      return buf.toString("utf-8");
    }
  }

  return "";
}

export default function Terminal({ socket, replId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(socket);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"connecting" | "active" | "disconnected">("connecting");

  // Keep socketRef synchronized on every render so callbacks never hold stale references
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Initialize xterm instance synchronously inside client component
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: "#0B0D11",
        foreground: "#E2E8F0",
        cursor: "#E73F1E",
        selectionBackground: "#334155",
        black: "#1E293B",
        red: "#EF4444",
        green: "#10B981",
        yellow: "#F59E0B",
        blue: "#3B82F6",
        magenta: "#8B5CF6",
        cyan: "#06B6D4",
        white: "#F8FAFC",
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    try {
      fitAddon.fit();
    } catch {}

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[38;2;231;63;30m=== Vessel Docker Sandbox Terminal ===\x1b[0m");
    term.writeln("\x1b[90mConnected via WebSocket to isolated container bash PTY.\x1b[0m\n");

    // If socket is already connected when terminal mounts, request PTY
    const activeSocket = socketRef.current;
    if (activeSocket && activeSocket.connected) {
      setStatus("active");
      activeSocket.emit("requestTerminal");
      activeSocket.emit("terminalResize", { cols: term.cols, rows: term.rows });
    }

    // Keystroke forwarding (uses socketRef so it never has a stale socket closure)
    const dataSub = term.onData((data: string) => {
      const s = socketRef.current;
      if (s && s.connected) {
        s.emit("terminalData", { data, terminalId: 0 });
      }
    });

    // Resize forwarding
    const resizeSub = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      const s = socketRef.current;
      if (s && s.connected) {
        s.emit("terminalResize", { cols, rows });
      }
    });

    const handleWindowResize = () => {
      try {
        if (terminalRef.current && terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
          fitAddon.fit();
          term.scrollToBottom();
        }
      } catch {}
    };
    window.addEventListener("resize", handleWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && terminalRef.current) {
      resizeObserver = new ResizeObserver(() => {
        try {
          if (terminalRef.current && terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
            fitAddon.fit();
            term.scrollToBottom();
          }
        } catch {}
      });
      resizeObserver.observe(terminalRef.current);
    }

    // Auto-focus terminal so typing works immediately
    setTimeout(() => {
      try {
        term.focus();
      } catch {}
    }, 150);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver?.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Handle Socket.IO connection and incoming terminal stream
  useEffect(() => {
    socketRef.current = socket;
    if (!socket) {
      setStatus("connecting");
      return;
    }

    const onConnect = () => {
      setStatus("active");
      socket.emit("requestTerminal");
      if (fitAddonRef.current && termInstanceRef.current) {
        try {
          fitAddonRef.current.fit();
          socket.emit("terminalResize", {
            cols: termInstanceRef.current.cols,
            rows: termInstanceRef.current.rows,
          });
        } catch {}
      }
    };

    const onDisconnect = () => {
      setStatus("disconnected");
    };

    const onTerminalData = (payload: any) => {
      const decoded = decodeData(payload?.data);
      if (decoded && termInstanceRef.current) {
        termInstanceRef.current.write(decoded);
      }
    };

    if (socket.connected) {
      onConnect();
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("terminal", onTerminalData);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("terminal", onTerminalData);
    };
  }, [socket]);

  const handleClear = () => {
    termInstanceRef.current?.clear();
  };

  const handleCopy = () => {
    if (termInstanceRef.current) {
      const selection = termInstanceRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0D11] border-t border-[#232936]">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#12151B] border-b border-[#232936] text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-[#E73F1E]" />
          <span className="font-mono text-slate-300 font-semibold">Terminal</span>
          <span
            className={`w-2 h-2 rounded-full ${
              status === "active"
                ? "bg-emerald-500 animate-pulse"
                : status === "connecting"
                ? "bg-amber-500"
                : "bg-rose-500"
            }`}
            title={`Status: ${status}`}
          />
          <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
            bash &bull; node-pty
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Copy selection"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClear}
            title="Clear terminal"
            className="px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        className="flex-1 p-2 overflow-hidden cursor-text"
        ref={terminalRef}
        onClick={() => {
          try {
            termInstanceRef.current?.focus();
          } catch {}
        }}
      />
    </div>
  );
}
