import { Loader2 } from "lucide-react";

export default function ProjectWorkspaceLoading() {
  return (
    <div className="h-screen w-screen bg-[#0B0D11] text-white flex flex-col items-center justify-center font-sans">
      <div className="flex flex-col items-center max-w-sm text-center px-4">
        <div className="w-12 h-12 rounded-2xl bg-[#181C24] border border-[#232936] flex items-center justify-center mb-6">
          <Loader2 className="w-6 h-6 animate-spin text-[#E73F1E]" />
        </div>
        <h2 className="text-base font-bold text-white mb-2">Preparing Isolated Sandbox</h2>
        <p className="text-xs font-mono text-slate-400 mb-4">
          Verifying project ownership &bull; Hydrating workspace from S3 &bull; Booting Docker container
        </p>

        <div className="w-48 h-1 bg-[#181C24] rounded-full overflow-hidden">
          <div className="w-full h-full bg-[#E73F1E] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
