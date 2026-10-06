"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function ProjectWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error?.message?.toLowerCase().includes("chunk") ||
    error?.name === "ChunkLoadError";

  const handleRetry = () => {
    if (isChunkError) {
      window.location.reload();
    } else {
      reset();
    }
  };

  return (
    <div className="h-screen w-screen bg-[#0B0D11] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#12151B] border border-rose-500/20 rounded-2xl p-8 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-white mb-2">Workspace Access Error</h2>
        <p className="text-xs text-slate-400 font-mono mb-6">
          {error.message || "Failed to initialize workspace or verify project ownership."}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-[#E73F1E] hover:bg-[#ff4d29] text-white text-xs font-semibold rounded-lg transition inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isChunkError ? "Reload Page" : "Retry Connection"}</span>
          </button>
          <Link
            href="/projects"
            className="px-4 py-2 bg-[#181C24] hover:bg-[#232936] text-slate-300 text-xs rounded-lg transition"
          >
            Back to Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
