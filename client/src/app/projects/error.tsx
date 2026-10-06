"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0B0D11] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#12151B] border border-rose-500/20 rounded-2xl p-8 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-white mb-2">Error Loading Projects</h2>
        <p className="text-xs text-slate-400 font-mono mb-6">
          {error.message || "An unexpected error occurred while fetching projects from the database."}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="flex items-center gap-2 px-4 py-2 bg-[#E73F1E] hover:bg-[#ff4d29] text-white text-xs font-semibold rounded-lg transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
          <Link
            href="/signin"
            className="px-4 py-2 bg-[#181C24] hover:bg-[#232936] text-slate-300 text-xs rounded-lg transition"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
