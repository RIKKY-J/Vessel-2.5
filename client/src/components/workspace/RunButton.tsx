"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Settings, Loader2, Check, RotateCcw } from "lucide-react";

interface RunButtonProps {
  isRunning: boolean;
  language: string;
  runCommand: string;
  onRun: (command?: string) => void;
  onCommandChange: (command: string) => void;
}

export default function RunButton({
  isRunning,
  language,
  runCommand,
  onRun,
  onCommandChange,
}: RunButtonProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const defaultCommand = language === "python" ? "python3 main.py" : "node --watch index.js";
  const [commandInput, setCommandInput] = useState(runCommand || defaultCommand);
  const [justSaved, setJustSaved] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCommandInput(runCommand || defaultCommand);
  }, [runCommand, defaultCommand]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsOpen]);

  const presets =
    language === "python"
      ? ["python3 main.py", "python main.py", "python3 app.py"]
      : ["node --watch index.js", "npm start", "npm run dev", "node index.js"];

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalCmd = commandInput.trim() || defaultCommand;
    setCommandInput(finalCmd);
    onCommandChange(finalCmd);
    setJustSaved(true);
    setTimeout(() => {
      setJustSaved(false);
      setIsSettingsOpen(false);
    }, 400);
  };

  return (
    <div className="relative inline-flex items-center rounded-lg shadow-sm h-8">
      {/* Primary Run Button */}
      <button
        onClick={() => onRun()}
        disabled={isRunning}
        className="h-8 flex items-center gap-1.5 px-3.5 bg-[#E73F1E] hover:bg-[#ff4d29] disabled:opacity-50 text-white font-semibold text-xs rounded-l-lg transition active:scale-[0.98] cursor-pointer select-none"
        title="Run Application (Ctrl+Enter)"
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current shrink-0" />
        )}
        <span>{isRunning ? "Running..." : "Run"}</span>
      </button>

      {/* Settings Popover Trigger */}
      <button
        onClick={() => setIsSettingsOpen((prev) => !prev)}
        className="h-8 w-8 flex items-center justify-center bg-[#E73F1E] hover:bg-[#ff4d29] text-white rounded-r-lg transition border-l border-black/20 active:scale-[0.98] cursor-pointer shrink-0 select-none"
        title="Configure Run Command"
      >
        <Settings className="w-3.5 h-3.5 shrink-0" />
      </button>

      {/* Popover */}
      {isSettingsOpen && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 w-72 bg-[#12151B] border border-[#232936] rounded-xl p-4 shadow-2xl z-50 text-left font-sans"
        >
          <h4 className="text-xs font-bold text-white mb-1">Run Configuration</h4>
          <p className="text-[10px] text-slate-400 font-mono mb-3">
            Command executed inside the Docker sandbox container
          </p>

          <form onSubmit={handleSave}>
            <div className="mb-3">
              <label className="block text-[10px] font-mono text-slate-300 mb-1">
                Start Command
              </label>
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                className="w-full bg-[#0B0D11] border border-[#232936] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#E73F1E]"
              />
            </div>

            <div className="mb-4">
              <span className="block text-[10px] font-mono text-slate-400 mb-1">Presets:</span>
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCommandInput(preset)}
                    className="text-[10px] font-mono px-2 py-0.5 bg-[#181C24] hover:bg-[#232936] text-slate-300 rounded border border-[#232936] transition"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#1C212B] pt-3">
              <button
                type="button"
                onClick={() => setCommandInput(defaultCommand)}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-mono flex items-center gap-1"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset
              </button>

              <button
                type="submit"
                className="px-3 py-1 bg-[#E73F1E] hover:bg-[#ff4d29] text-white text-xs font-semibold rounded transition flex items-center gap-1"
              >
                {justSaved ? <Check className="w-3 h-3" /> : null}
                <span>{justSaved ? "Saved!" : "Save"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
