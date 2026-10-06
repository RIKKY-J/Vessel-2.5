"use client";

import React, { useState, useEffect, useRef } from "react";
import { RefreshCw, ExternalLink, Globe } from "lucide-react";

interface PreviewProps {
  replId: string;
}

export default function Preview({ replId }: PreviewProps) {
  const [iframeKey, setIframeKey] = useState(0);
  const [isAutoReloading, setIsAutoReloading] = useState(false);
  const reloadTimerRef = useRef<NodeJS.Timeout | null>(null);

  const previewUrl = `/api/preview/${encodeURIComponent(replId)}/`;

  const refreshIframe = () => {
    setIframeKey((prev) => prev + 1);
  };

  // Real-time auto-reload listener on file updates
  useEffect(() => {
    const handleFileUpdated = (event: any) => {
      const updatedReplId = event?.detail?.replId;
      if (updatedReplId && updatedReplId !== replId) return;

      setIsAutoReloading(true);
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }

      reloadTimerRef.current = setTimeout(() => {
        setIframeKey((prev) => prev + 1);
        setIsAutoReloading(false);
      }, 600);
    };

    window.addEventListener("vessel:file-updated", handleFileUpdated);

    return () => {
      window.removeEventListener("vessel:file-updated", handleFileUpdated);
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
    };
  }, [replId]);

  return (
    <div className="flex flex-col h-full bg-[#0B0D11] border-b border-[#232936] select-none">
      {/* Browser Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#12151B] border-b border-[#232936] text-xs shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
          <Globe className="w-3.5 h-3.5 text-[#E73F1E]" />
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0B0D11] border border-[#232936] rounded-md text-[11px] font-mono text-slate-300 flex-1 truncate">
            <span className="text-emerald-400 font-bold">
              {typeof window !== "undefined" && window.location.protocol === "https:" ? "HTTPS" : "HTTP"}
            </span>
            <span className="text-slate-500">|</span>
            <span className="truncate">{previewUrl}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={refreshIframe}
            disabled={isAutoReloading}
            title="Refresh preview"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAutoReloading ? "animate-spin text-[#E73F1E]" : ""}`} />
          </button>

          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open preview in new tab"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Iframe Viewport */}
      <div className="flex-1 bg-white relative">
        <iframe
          key={iframeKey}
          src={`${previewUrl}${iframeKey > 0 ? `?_t=${iframeKey}` : ""}`}
          title={`Preview ${replId}`}
          className="w-full h-full border-none"
          sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
}
