import { Loader2 } from "lucide-react";

export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-[#0B0D11] text-white flex flex-col font-sans">
      <header className="h-16 border-b border-[#232936] px-6 sm:px-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-[#181C24] border border-[#232936] flex items-center justify-center font-mono text-xs text-[#E73F1E] font-bold">
            &lt;/&gt;
          </span>
          <span className="font-semibold text-sm tracking-wide text-white font-mono">
            vessel.projects
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#E73F1E] animate-spin mb-4" />
        <p className="text-sm font-mono text-slate-300">Loading workspaces from database...</p>
        <p className="text-xs font-mono text-slate-500 mt-1">Connecting MySQL pool &bull; Verifying session</p>
      </main>
    </div>
  );
}
