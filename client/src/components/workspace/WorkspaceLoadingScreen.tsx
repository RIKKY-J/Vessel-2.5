"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Server,
  FolderGit2,
  Cpu,
  Terminal,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Box,
  Layers,
  Sparkles,
} from "lucide-react";

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const STEPS: Step[] = [
  {
    id: "container",
    title: "Provision Cloud Sandbox",
    description: "Allocating isolated container and virtual network ports",
    icon: Server,
  },
  {
    id: "filesystem",
    title: "Mount Workspace Filesystem",
    description: "Preparing project templates and persistent storage",
    icon: FolderGit2,
  },
  {
    id: "daemon",
    title: "Bootstrap Runner Daemon",
    description: "Initializing runtime engine & daemon on port 3001",
    icon: Cpu,
  },
  {
    id: "terminal",
    title: "Connect Terminal Bridge",
    description: "Establishing WebSocket stream to isolated bash PTY",
    icon: Terminal,
  },
];

interface WorkspaceLoadingScreenProps {
  projectName: string;
  language: string;
  replId: string;
  isSandboxReady: boolean;
  isSocketConnected: boolean;
  sandboxStatusText: string;
  error?: string | null;
  onRetry?: () => void;
  onComplete: () => void;
  onSkip?: () => void;
}

export default function WorkspaceLoadingScreen({
  projectName,
  language,
  replId,
  isSandboxReady,
  isSocketConnected,
  sandboxStatusText,
  error,
  onRetry,
  onComplete,
  onSkip,
}: WorkspaceLoadingScreenProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    `[0.0s] Initializing workspace session for ${replId}`,
    `[0.4s] Requesting sandbox provisioning (${language})`,
  ]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedSecondsRef = useRef(0);
  const [isFinishing, setIsFinishing] = useState(false);

  // Timer ticker for elapsed seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        elapsedSecondsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Step progression and auto-completion when sandbox and socket are ready
  useEffect(() => {
    const ts = `[${elapsedSecondsRef.current}s]`;

    if (error) {
      setLogs((prev) => [...prev, `${ts} Error: ${error}`]);
      return;
    }

    if (isSocketConnected) {
      // All steps complete!
      setCurrentStepIndex(4);
      setLogs((prev) => {
        if (!prev.some((l) => l.includes("WebSocket bridge connected"))) {
          return [
            ...prev,
            `${ts} WebSocket bridge connected to runner daemon`,
            `${ts} Interactive PTY ready. Launching workspace!`,
          ];
        }
        return prev;
      });

      // Brief pause to show 100% completion before revealing the IDE
      setIsFinishing(true);
      const exitTimer = setTimeout(() => {
        onComplete();
      }, 600);
      return () => clearTimeout(exitTimer);
    }

    if (isSandboxReady) {
      // Step 3 is done, Step 4 (terminal connection) is in progress
      setCurrentStepIndex(3);
      setLogs((prev) => {
        if (!prev.some((l) => l.includes("Runner daemon active"))) {
          return [
            ...prev,
            `${ts} Runner daemon active on port 3001`,
            `${ts} Connecting WebSocket terminal bridge...`,
          ];
        }
        return prev;
      });

      // Fallback timer: if container is verified ready, advance after 2.5s even if socket handshake was slightly delayed
      const fallbackTimer = setTimeout(() => {
        setCurrentStepIndex(4);
        setIsFinishing(true);
        setTimeout(onComplete, 400);
      }, 2500);
      return () => clearTimeout(fallbackTimer);
    }
  }, [isSandboxReady, isSocketConnected, error, onComplete]);

  // Boot stages 1 & 2 while container is provisioning
  useEffect(() => {
    if (isSandboxReady || isSocketConnected) return;

    if (sandboxStatusText.toLowerCase().includes("starting") || elapsedSeconds >= 3) {
      setCurrentStepIndex((prev) => Math.max(prev, 2));
      setLogs((prev) => {
        if (!prev.some((l) => l.includes("Bootstrapping runner"))) {
          return [
            ...prev,
            `[${elapsedSeconds}s] Workspace filesystem mounted`,
            `[${elapsedSeconds}s] Bootstrapping runner daemon & security sandbox...`,
          ];
        }
        return prev;
      });
    } else if (elapsedSeconds >= 1) {
      setCurrentStepIndex((prev) => Math.max(prev, 1));
      setLogs((prev) => {
        if (!prev.some((l) => l.includes("Allocating cloud container"))) {
          return [...prev, `[${elapsedSeconds}s] Allocating cloud container network & IP...`];
        }
        return prev;
      });
    }
  }, [elapsedSeconds, sandboxStatusText, isSandboxReady, isSocketConnected]);

  // Overall percentage calculation
  const progressPercent = Math.min(
    100,
    currentStepIndex === 0
      ? Math.min(25, 10 + elapsedSeconds * 4)
      : currentStepIndex === 1
      ? Math.min(50, 25 + elapsedSeconds * 3)
      : currentStepIndex === 2
      ? Math.min(75, 50 + elapsedSeconds * 2)
      : currentStepIndex === 3
      ? Math.min(95, 75 + elapsedSeconds * 3)
      : 100
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B0D11] text-white select-none transition-opacity duration-500 overflow-hidden ${
        isFinishing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Background ambient glowing orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[#E73F1E]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[500px] h-[300px] bg-blue-600/5 rounded-full blur-[140px] pointer-events-none" />

      {/* Subtle tech background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, #ffffff 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* Main Glassmorphic Loading Card */}
      <div className="relative z-10 w-full max-w-xl mx-4 bg-[#12151B]/95 backdrop-blur-xl border border-[#232936] rounded-2xl shadow-2xl shadow-black/80 p-6 sm:p-8 flex flex-col">
        {/* Top Header: Logo & Project Info */}
        <div className="flex items-center justify-between pb-6 border-b border-[#232936]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center border border-slate-200 shadow-sm shrink-0 overflow-hidden">
              <img
                src="/vessel-logo.png"
                alt="Vessel Logo"
                className="w-full h-full object-contain scale-125"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-white tracking-wide">
                  vessel.editor
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#181C24] text-slate-400 border border-[#232936]">
                  {language}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono truncate max-w-[280px]">
                {projectName}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end text-xs font-mono">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E73F1E] animate-ping" />
              <span>
                {Math.floor(elapsedSeconds / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(elapsedSeconds % 60).toString().padStart(2, "0")}s
              </span>
            </span>
            <span className="text-[10px] text-slate-500">elapsed</span>
          </div>
        </div>

        {/* Dynamic Title & Progress Bar */}
        <div className="py-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              {currentStepIndex >= 4 ? (
                <>
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">Environment Ready! Launching...</span>
                </>
              ) : error ? (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span className="text-rose-400">Provisioning Error</span>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 text-[#E73F1E] animate-spin" />
                  <span>Preparing Development Sandbox...</span>
                </>
              )}
            </span>
            <span className="text-xs font-mono font-bold text-[#E73F1E]">
              {progressPercent}%
            </span>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div className="h-2 w-full bg-[#181C24] rounded-full overflow-hidden border border-[#232936] p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out shadow-sm ${
                currentStepIndex >= 4
                  ? "bg-emerald-500 shadow-emerald-500/50"
                  : "bg-gradient-to-r from-[#E73F1E] to-[#FF6B4A] shadow-[#E73F1E]/50"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Step-by-Step Pipeline Checklist */}
        <div className="space-y-3 mb-6">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex && currentStepIndex < 4;
            const isPending = index > currentStepIndex;

            return (
              <div
                key={step.id}
                className={`flex items-start gap-3.5 p-3 rounded-xl border transition-all duration-300 ${
                  isCompleted
                    ? "bg-[#181C24]/40 border-emerald-500/20 text-slate-300"
                    : isCurrent
                    ? "bg-[#181C24] border-[#E73F1E]/40 text-white shadow-lg shadow-[#E73F1E]/5"
                    : "bg-[#12151B]/40 border-transparent text-slate-500 opacity-60"
                }`}
              >
                {/* Step Status Icon */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-all ${
                    isCompleted
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : isCurrent
                      ? "bg-[#E73F1E]/10 border-[#E73F1E]/40 text-[#E73F1E]"
                      : "bg-[#181C24] border-[#232936] text-slate-600"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#E73F1E]" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </div>

                {/* Step Labels */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold ${
                        isCompleted
                          ? "text-slate-200"
                          : isCurrent
                          ? "text-white font-bold"
                          : "text-slate-500"
                      }`}
                    >
                      {step.title}
                    </span>
                    {isCompleted && (
                      <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider font-semibold">
                        Ready
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[10px] font-mono text-[#E73F1E] uppercase tracking-wider font-semibold animate-pulse">
                        In Progress
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Mini Terminal Log Feed */}
        <div className="bg-[#0B0D11] border border-[#232936] rounded-xl p-3 font-mono text-[11px] text-slate-400 mb-6 overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#181C24] text-[10px] text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Live Deployment Stream</span>
            </span>
            <span>replId: {replId.slice(0, 14)}...</span>
          </div>
          <div className="space-y-1 max-h-20 overflow-y-auto select-text scrollbar-thin">
            {logs.slice(-4).map((log, i) => (
              <div key={i} className="truncate flex items-center gap-2">
                <span className="text-slate-600">&gt;</span>
                <span
                  className={
                    log.includes("Error")
                      ? "text-rose-400"
                      : log.includes("Ready") || log.includes("active")
                      ? "text-emerald-300"
                      : "text-slate-300"
                  }
                >
                  {log}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-[#232936] text-xs">
          {error ? (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-xl bg-[#E73F1E] hover:bg-[#ff4d29] text-white font-semibold transition flex items-center gap-2 cursor-pointer shadow-lg shadow-[#E73F1E]/20"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Boot</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              <span>Isolated Fargate Container</span>
            </div>
          )}

          {onSkip && (
            <button
              onClick={onSkip}
              className="text-xs text-slate-400 hover:text-white transition flex items-center gap-1 font-mono cursor-pointer py-1 px-2 rounded-lg hover:bg-[#181C24]"
              title="Open code editor while environment finishes in background"
            >
              <span>Skip to Editor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
