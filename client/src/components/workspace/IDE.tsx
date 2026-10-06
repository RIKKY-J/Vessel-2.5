"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { Socket, io } from "socket.io-client";
import {
  Columns,
  Code2,
  Globe,
  Terminal as TerminalIcon,
  ArrowLeft,
  Loader2,
  Square,
  Save,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { File, RemoteFile, Type } from "@/components/editor/file-manager";
import Editor from "@/components/editor/Editor";
import FileExplorer from "@/components/editor/FileExplorer";
import Preview from "@/components/preview/Preview";
import RunButton from "./RunButton";

const Terminal = dynamic(() => import("@/components/terminal/Terminal"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-[#0B0D11] text-slate-400 font-mono text-xs select-none">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2.5 h-2.5 rounded-full border-2 border-[#E73F1E] border-t-transparent animate-spin" />
        <span className="text-white font-medium">Initializing Terminal Engine...</span>
      </div>
      <span className="text-[11px] text-slate-500">Loading xterm.js PTY subsystem</span>
    </div>
  ),
});

type ViewMode = "split" | "code" | "preview" | "terminal";

interface IDEProps {
  initialProject: {
    id: string;
    name: string;
    repl_id: string;
    language: string;
    status: string;
    run_command?: string;
  };
  initialFiles: RemoteFile[];
  user: {
    userId: string;
    email: string;
    name: string;
    isGuest?: boolean;
  };
}

export default function IDE({ initialProject, initialFiles, user }: IDEProps) {
  const router = useRouter();
  const replId = initialProject.repl_id;
  const language = initialProject.language;

  const [files, setFiles] = useState<RemoteFile[]>(initialFiles);
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined);
  const fileContentsRef = useRef<Record<string, string>>({});
  const dirtyFilesRef = useRef<Set<string>>(new Set());

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isSandboxReady, setIsSandboxReady] = useState(false);
  const [sandboxStatusText, setSandboxStatusText] = useState("Connecting to sandbox...");
  const [runnerPort, setRunnerPort] = useState<number>(3001);

  // Layout & Resizing States
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [mainSplit, setMainSplit] = useState(55);
  const [rightSplit, setRightSplit] = useState(50);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [runCommand, setRunCommand] = useState(
    initialProject.run_command || (language === "python" ? "python3 main.py" : "node --watch index.js")
  );
  const [isStopping, setIsStopping] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize selected file from initial files
  useEffect(() => {
    if (initialFiles.length > 0) {
      const map: Record<string, string> = {};
      initialFiles.forEach((f) => {
        if (f.content !== undefined) map[f.path] = f.content;
      });
      fileContentsRef.current = { ...fileContentsRef.current, ...map };

      const preferred =
        initialFiles.find((f) => f.name === "main.py" || f.name === "index.js") || initialFiles[0];

      if (preferred) {
        setSelectedFile({
          id: preferred.path,
          name: preferred.name,
          path: preferred.path,
          parentId: "0",
          type: Type.FILE,
          depth: 0,
          content: preferred.content ?? map[preferred.path] ?? "",
        });
      }
    }
  }, [initialFiles]);

  // Fallback client-side fetch if files were empty on mount
  useEffect(() => {
    if (files.length === 0 && replId) {
      axios
        .get(`/api/projects/${encodeURIComponent(replId)}/files`)
        .then((res) => {
          if (res.data?.files && res.data.files.length > 0) {
            setFiles(res.data.files);
            const map: Record<string, string> = {};
            res.data.files.forEach((f: RemoteFile) => {
              if (f.content !== undefined) map[f.path] = f.content;
            });
            fileContentsRef.current = { ...fileContentsRef.current, ...map };

            const preferred =
              res.data.files.find((f: RemoteFile) => f.name === "main.py" || f.name === "index.js") ||
              res.data.files[0];

            setSelectedFile({
              id: preferred.path,
              name: preferred.name,
              path: preferred.path,
              parentId: "0",
              type: Type.FILE,
              depth: 0,
              content: preferred.content ?? map[preferred.path] ?? "",
            });
          }
        })
        .catch(() => {});
    }
  }, [replId, files.length]);

  // Handle Drag Resizing across all panels
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar) {
        e.preventDefault();
        const newWidth = Math.max(140, Math.min(450, e.clientX));
        setSidebarWidth(newWidth);
      } else if (isDraggingMain && workspaceRef.current) {
        e.preventDefault();
        const rect = workspaceRef.current.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const newSplit = Math.max(20, Math.min(80, (relativeX / rect.width) * 100));
        setMainSplit(newSplit);
      } else if (isDraggingRight && rightPaneRef.current) {
        e.preventDefault();
        const rect = rightPaneRef.current.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const newSplit = Math.max(15, Math.min(85, (relativeY / rect.height) * 100));
        setRightSplit(newSplit);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      setIsDraggingMain(false);
      setIsDraggingRight(false);
    };

    const isDragging = isDraggingSidebar || isDraggingMain || isDraggingRight;
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSidebar, isDraggingMain, isDraggingRight]);

  // Start sandbox container & poll status
  useEffect(() => {
    if (!replId) return;
    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;

    setSandboxStatusText("Starting Docker sandbox container...");

    const checkStatus = async () => {
      try {
        const res = await axios.get(`/api/projects/${encodeURIComponent(replId)}/status`);
        if (!isMounted) return;

        if (res.data?.runnerPort) {
          setRunnerPort(res.data.runnerPort);
        }

        if (res.data?.error) {
          setSandboxStatusText(`Docker: ${res.data.error}`);
        } else if (res.data?.ready) {
          if (pollInterval) clearInterval(pollInterval);
          setSandboxStatusText("Sandbox ready! Connecting terminal...");
          setIsSandboxReady(true);
        } else if (res.data?.statusText) {
          setSandboxStatusText(res.data.statusText);
        }
      } catch (err: any) {
        // Will retry
      }
    };

    axios
      .post(`/api/projects/${encodeURIComponent(replId)}/start`)
      .then((res) => {
        if (!isMounted) return;
        if (res.data?.sandbox?.error) {
          setSandboxStatusText(`Docker: ${res.data.sandbox.error}`);
        }
        checkStatus();
        pollInterval = setInterval(checkStatus, 1500);
      })
      .catch((err) => {
        const msg = err?.response?.data?.error || err.message;
        console.warn("Start sandbox error:", msg);
        if (isMounted) setSandboxStatusText(`Container start error: ${msg}`);
      });

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [replId]);

  // Connect WebSocket to Runner via unified Port 3000 proxy
  useEffect(() => {
    if (!isSandboxReady || !replId) return;

    // Give the runner container a few seconds to fully boot its Socket.IO server
    let socketInstance: ReturnType<typeof io> | null = null;
    const connectDelay = setTimeout(() => {
      // Use window.location.origin (Port 3000) so no secondary ports are needed
      const wsUrl =
        process.env.NEXT_PUBLIC_RUNNER_WS_URL ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

      console.log(`[IDE] Connecting Socket.IO to ${wsUrl} for replId=${replId}`);

      const newSocket = io(wsUrl, {
        // Start with direct WebSocket, fallback to polling
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 40,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 3000,
        timeout: 20000,
        query: { replId },
        auth: { replId },
      });

      newSocket.on("connect", () => {
        console.log(`[IDE] Socket connected to runner at ${wsUrl}, transport=${newSocket.io?.engine?.transport?.name}`);
      });

      newSocket.on("fileUpdated", ({ path: filePath, content }: { path: string; content: string }) => {
        fileContentsRef.current[filePath] = content;
        setSelectedFile((currentSelected) => {
          if (currentSelected && currentSelected.path === filePath) {
            return {
              ...currentSelected,
              content,
            };
          }
          return currentSelected;
        });
      });

      newSocket.on("connect_error", (err) => {
        console.warn(`[IDE] Socket connection error:`, err.message);
      });

      socketInstance = newSocket;
      setSocket(newSocket);
    }, 3000); // Wait 3s for runner to fully start

    return () => {
      clearTimeout(connectDelay);
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [isSandboxReady, replId]);

  // Auto-save timer ref
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle file editing
  const handleContentChange = (newContent: string) => {
    if (!selectedFile) return;
    fileContentsRef.current[selectedFile.path] = newContent;
    dirtyFilesRef.current.add(selectedFile.path);

    setSelectedFile((prev) => (prev ? { ...prev, content: newContent } : undefined));

    // Emit live file change to runner if socket active
    if (socket && socket.connected) {
      socket.emit("updateContent", {
        path: selectedFile.path,
        content: newContent,
      });
    }

    // Debounced auto-save to disk after 800ms of inactivity
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveToS3();
    }, 800);
  };

  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Save active files to disk / S3
  const handleSaveToS3 = async () => {
    if (!replId || isSaving) return;
    setIsSaving(true);

    const filesToSync: { path: string; content: string }[] = [];
    if (dirtyFilesRef.current.size > 0) {
      dirtyFilesRef.current.forEach((filePath) => {
        filesToSync.push({
          path: filePath,
          content: fileContentsRef.current[filePath] ?? "",
        });
      });
    } else if (selectedFile && selectedFile.content !== undefined) {
      filesToSync.push({
        path: selectedFile.path,
        content: selectedFile.content,
      });
    }

    if (filesToSync.length > 0) {
      try {
        await axios.post(`/api/projects/${encodeURIComponent(replId)}/sync`, {
          files: filesToSync,
        });
        dirtyFilesRef.current.clear();

        // Dispatch preview reload so the webview stays synchronized with saved files
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("vessel:file-updated", {
              detail: { replId, path: selectedFile?.path },
            })
          );
        }
      } catch (err) {
        console.warn("Save files error:", err);
      }
    }

    setIsSaving(false);
  };

  // Refresh workspace files from disk / server and update editor content
  const handleRefreshFiles = async () => {
    if (!replId) return;
    try {
      const res = await axios.get(
        `/api/projects/${encodeURIComponent(replId)}/files?_t=${Date.now()}`
      );
      if (res.data?.files && Array.isArray(res.data.files)) {
        const fetchedFiles: RemoteFile[] = res.data.files;
        setFiles(fetchedFiles);

        // 1. Update in-memory content cache for all fetched files
        fetchedFiles.forEach((f) => {
          if (f.content !== undefined) {
            fileContentsRef.current[f.path] = f.content;
          }
        });

        // 2. Clear dirty state for clean sync
        dirtyFilesRef.current.clear();

        // 3. Immediately update the currently open file in editor with fresh content
        setSelectedFile((currentSelected) => {
          if (!currentSelected) return currentSelected;
          const fresh = fetchedFiles.find((f) => f.path === currentSelected.path);
          if (fresh && fresh.content !== undefined) {
            return {
              ...currentSelected,
              content: fresh.content,
            };
          }
          return currentSelected;
        });
      }
    } catch (err) {
      console.warn("Refresh files error:", err);
    }
  };

  // Run command handler (saves files first, sends into terminal PTY, and triggers backend runner)
  const handleRun = async (overrideCmd?: string) => {
    if (isRunning || !replId) return;
    setIsRunning(true);

    if (viewMode === "code") {
      setViewMode("split");
    }

    // 1. Ensure all active/modified files are written to /workspace before running
    await handleSaveToS3();

    const cmdToRun =
      overrideCmd ||
      runCommand ||
      (initialProject.language === "python" ? "python3 main.py" : "node --watch index.js");

    // 2. Send Ctrl+C followed by the command into the terminal PTY for live terminal output
    if (socket && socket.connected) {
      socket.emit("terminalData", {
        data: `\x03\r\n${cmdToRun}\r\n`,
        terminalId: 0,
      });
    }

    // 3. Also send backend runner API call
    try {
      await axios.post(
        `/api/projects/${encodeURIComponent(replId)}/run`,
        {
          command: cmdToRun,
          path: selectedFile?.path,
          content: selectedFile?.content,
        },
        { timeout: 4000 }
      );
    } catch (err) {
      console.warn("Error running project:", err);
    } finally {
      // 4. Trigger auto-reload in preview iframe once server starts listening
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("vessel:file-updated", {
              detail: { replId, path: selectedFile?.path },
            })
          );
        }
        setIsRunning(false);
      }, 1500);
    }
  };

  // Close & stop project
  const handleCloseProject = async () => {
    if (isStopping) return;
    setIsStopping(true);

    // Save files before shutdown
    await handleSaveToS3();

    try {
      await axios.post(`/api/projects/${encodeURIComponent(replId)}/stop`);
    } catch (err) {
      console.warn("Error stopping sandbox:", err);
    }

    window.location.href = "/projects";
  };

  // Keyboard shortcut Ctrl+Enter to Run, Ctrl+S to Save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRun();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveToS3();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [replId, selectedFile, isRunning, runCommand]);

  // Tab exit auto-sync
  useEffect(() => {
    if (!replId) return;
    const handleExit = () => {
      if (dirtyFilesRef.current.size === 0) return;
      const filesToSave = Array.from(dirtyFilesRef.current).map((filePath) => ({
        path: filePath,
        content: fileContentsRef.current[filePath] ?? "",
      }));

      try {
        fetch(`/api/projects/${encodeURIComponent(replId)}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: filesToSave }),
          keepalive: true,
        });
      } catch {}
    };

    window.addEventListener("beforeunload", handleExit);
    window.addEventListener("pagehide", handleExit);

    return () => {
      window.removeEventListener("beforeunload", handleExit);
      window.removeEventListener("pagehide", handleExit);
    };
  }, [replId]);

  // Instantly trigger window resize when viewMode or splits change so xterm.js fitAddon and Monaco Editor adapt without delay
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const timer1 = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
    const timer2 = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 150);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [viewMode, mainSplit, rightSplit]);

  const isDraggingAny = isDraggingSidebar || isDraggingMain || isDraggingRight;

  return (
    <div
      className={`h-screen w-screen bg-[#0B0D11] text-white flex flex-col overflow-hidden font-sans select-none ${
        isDraggingAny ? "cursor-grabbing select-none" : ""
      }`}
    >
      {/* Top IDE Toolbar */}
      <header className="h-12 border-b border-[#232936] bg-[#12151B] px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={handleCloseProject}
            title="Back to Projects Dashboard"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition font-mono group cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Projects</span>
          </button>
          <span className="text-slate-600">/</span>
          <div className="w-6 h-6 rounded-md bg-white p-0.5 flex items-center justify-center shrink-0 shadow-sm border border-slate-200">
            <img src="/vessel-logo.png" alt="Vessel" className="w-full h-full object-contain" />
          </div>
          <span className="font-mono text-xs font-bold text-slate-200 truncate">
            {initialProject.name}
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#181C24] text-slate-400 border border-[#232936]">
            {language}
          </span>
        </div>

        {/* Center: Run & Save Controls */}
        <div className="flex items-center gap-2">
          <RunButton
            isRunning={isRunning}
            language={language}
            runCommand={runCommand}
            onRun={(cmd) => handleRun(cmd)}
            onCommandChange={(cmd) => setRunCommand(cmd)}
          />

          <button
            onClick={handleSaveToS3}
            disabled={isSaving}
            title="Save to persistent storage (Ctrl+S)"
            className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#181C24] border border-[#232936] rounded-lg transition cursor-pointer disabled:opacity-50 shrink-0"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-[#E73F1E]" /> : <Save className="w-4 h-4" />}
          </button>
        </div>

        {/* Right: Layout Switcher & Stop Container */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center bg-[#0B0D11] border border-[#232936] rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setViewMode("split")}
              className={`p-1.5 rounded transition ${viewMode === "split" ? "bg-[#181C24] text-white" : "text-slate-400 hover:text-white"}`}
              title="Split View"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("code")}
              className={`p-1.5 rounded transition ${viewMode === "code" ? "bg-[#181C24] text-white" : "text-slate-400 hover:text-white"}`}
              title="Code Only"
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className={`p-1.5 rounded transition ${viewMode === "preview" ? "bg-[#181C24] text-white" : "text-slate-400 hover:text-white"}`}
              title="Preview Only"
            >
              <Globe className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("terminal")}
              className={`p-1.5 rounded transition ${viewMode === "terminal" ? "bg-[#181C24] text-white" : "text-slate-400 hover:text-white"}`}
              title="Terminal Only"
            >
              <TerminalIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleCloseProject}
            disabled={isStopping}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-semibold transition cursor-pointer"
            title="Stop Docker Container"
          >
            {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
            <span className="hidden sm:inline">{isStopping ? "Stopping..." : "Stop"}</span>
          </button>
        </div>
      </header>

      {/* Guest Mode Notification Banner */}
      {user?.isGuest && (
        <div className="h-9 px-4 bg-gradient-to-r from-amber-500/15 via-[#E73F1E]/20 to-purple-500/15 border-b border-amber-500/30 flex items-center justify-between text-xs font-mono shrink-0 z-20">
          <div className="flex items-center gap-2 text-amber-200/90 min-w-0">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="font-bold text-amber-300 shrink-0">Temporary Guest Sandbox:</span>
            <span className="text-slate-300 truncate">Your edits & terminal are live. Sign up to save this project permanently.</span>
          </div>
          <Link
            href={`/signin?claim=${encodeURIComponent(replId)}`}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#E73F1E] hover:bg-[#ff4d29] text-white font-bold text-[11px] transition shadow shrink-0 active:scale-95"
          >
            <span>Claim & Save</span>
            <Sparkles className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Invisible Overlay during Dragging to prevent Monaco / iframe pointer trap */}
        {isDraggingAny && (
          <div className="fixed inset-0 z-50 bg-transparent cursor-grabbing" />
        )}

        {/* File Explorer Sidebar */}
        <FileExplorer
          width={sidebarWidth}
          files={files}
          selectedFile={selectedFile}
          onSelectFile={(f) => {
            const cached = fileContentsRef.current[f.path];
            setSelectedFile({
              ...f,
              content: cached !== undefined ? cached : f.content,
            });
          }}
          onRefresh={handleRefreshFiles}
          onNewFile={async (name) => {
            const newFile: RemoteFile = {
              name,
              path: name,
              type: "file",
              content: "",
            };
            setFiles((prev) => [...prev, newFile]);
            fileContentsRef.current[name] = "";
            setSelectedFile({
              id: name,
              name,
              path: name,
              parentId: "0",
              type: Type.FILE,
              depth: 0,
              content: "",
            });
            dirtyFilesRef.current.add(name);

            // Persist immediately to server
            try {
              await axios.post(`/api/projects/${encodeURIComponent(replId)}/sync`, {
                files: [{ path: name, content: "" }],
              });
            } catch (err) {
              console.warn("Immediate file save error:", err);
            }
          }}
          onNewFolder={async (name) => {
            const cleanName = name.trim().replace(/^\/+/, "");
            if (!cleanName) return;
            const newFolder: RemoteFile = {
              name: cleanName.split("/").pop() || cleanName,
              path: cleanName,
              type: "dir",
            };
            setFiles((prev) => [...prev.filter((f) => f.path !== cleanName), newFolder]);

            // Persist folder immediately to server and runner
            try {
              await axios.post(`/api/projects/${encodeURIComponent(replId)}/sync`, {
                folders: [cleanName],
              });
            } catch (err) {
              console.warn("Folder save error:", err);
            }
          }}
        />

        {/* Sidebar Vertical Resizer */}
        <div
          onMouseDown={() => setIsDraggingSidebar(true)}
          className="w-1 bg-[#232936] hover:bg-[#E73F1E] active:bg-[#E73F1E] cursor-col-resize transition shrink-0 select-none z-20"
        />

        {/* Persistent View Layout - Keeps Editor, Preview, and Terminal permanently mounted without resets */}
        <div ref={workspaceRef} className="flex-1 flex overflow-hidden">
          {/* Left: Editor Pane */}
          <div
            style={{
              width: viewMode === "code" ? "100%" : `${mainSplit}%`,
              display: viewMode === "split" || viewMode === "code" ? "flex" : "none",
            }}
            className={`h-full flex-col overflow-hidden ${isDraggingAny ? "pointer-events-none" : ""}`}
          >
            <Editor selectedFile={selectedFile} onChange={handleContentChange} />
          </div>

          {/* Main Split Resizer (Editor vs Right Column) - Only in Split mode */}
          {viewMode === "split" && (
            <div
              onMouseDown={() => setIsDraggingMain(true)}
              className="w-1 bg-[#232936] hover:bg-[#E73F1E] active:bg-[#E73F1E] cursor-col-resize transition shrink-0 select-none z-20"
            />
          )}

          {/* Right Column: Preview & Terminal */}
          <div
            ref={rightPaneRef}
            style={{
              width: viewMode === "split" ? `${100 - mainSplit}%` : "100%",
              display: viewMode === "code" ? "none" : "flex",
            }}
            className="h-full flex-col overflow-hidden"
          >
            {/* Preview Pane */}
            <div
              style={{
                height: viewMode === "preview" ? "100%" : `${rightSplit}%`,
                display: viewMode === "split" || viewMode === "preview" ? "flex" : "none",
              }}
              className={`flex-col overflow-hidden ${isDraggingAny ? "pointer-events-none" : ""}`}
            >
              <Preview replId={replId} />
            </div>

            {/* Horizontal Resizer (Preview vs Terminal) - Only in Split mode */}
            {viewMode === "split" && (
              <div
                onMouseDown={() => setIsDraggingRight(true)}
                className="h-1 bg-[#232936] hover:bg-[#E73F1E] active:bg-[#E73F1E] cursor-row-resize transition shrink-0 select-none z-20"
              />
            )}

            {/* Terminal Pane */}
            <div
              style={{
                height: viewMode === "terminal" ? "100%" : `${100 - rightSplit}%`,
                display: viewMode === "split" || viewMode === "terminal" ? "flex" : "none",
              }}
              className="flex-1 flex-col overflow-hidden min-h-0"
            >
              <Terminal socket={socket} replId={replId} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-6 bg-[#12151B] border-t border-[#232936] px-3 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                socket && socket.connected
                  ? "bg-emerald-500 animate-pulse"
                  : isSandboxReady
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
            />
            <span>
              {socket && socket.connected
                ? "Docker Sandbox Connected"
                : isSandboxReady
                ? "Sandbox Ready (Connecting WebSocket...)"
                : sandboxStatusText}
            </span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">{selectedFile ? selectedFile.path : "No active file"}</span>
        </div>

        <div className="flex items-center gap-3">
          <span>Port 3000 &bull; {runnerPort || 3001}</span>
          <span className="text-slate-600">|</span>
          <span>Next.js App Router</span>
        </div>
      </footer>
    </div>
  );
}
