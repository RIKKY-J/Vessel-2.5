"use client";

import React, { useState } from "react";
import {
  FileCode,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  FileText,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { File, RemoteFile, Directory, Type, buildFileTree } from "./file-manager";

interface FileExplorerProps {
  files: RemoteFile[];
  selectedFile: File | undefined;
  onSelectFile: (file: File) => void;
  onRefresh?: () => Promise<void> | void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  width?: number;
}

export default function FileExplorer({
  files,
  selectedFile,
  onSelectFile,
  onRefresh,
  onNewFile,
  onNewFolder,
  width,
}: FileExplorerProps) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const handleRefreshClick = async () => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(onRefresh()),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const tree = buildFileTree(files);

  const toggleDir = (dirId: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirId)) next.delete(dirId);
      else next.add(dirId);
      return next;
    });
  };

  const handleCreateFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFileName.trim() && onNewFile) {
      onNewFile(newFileName.trim());
      setNewFileName("");
      setIsCreatingFile(false);
    }
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim() && onNewFolder) {
      onNewFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

  const renderDirectory = (dir: Directory, depth: number = 0) => {
    const isCollapsed = collapsedDirs.has(dir.id);

    return (
      <div key={dir.id} className="select-none">
        {dir.id !== "root" && (
          <div
            onClick={() => toggleDir(dir.id)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-[#181C24] cursor-pointer rounded transition"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            {isCollapsed ? (
              <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <span className="font-mono truncate">{dir.name}</span>
          </div>
        )}

        {(!isCollapsed || dir.id === "root") && (
          <div>
            {dir.dirs.map((d) => renderDirectory(d, depth + 1))}
            {dir.files.map((f) => {
              const isSelected = selectedFile?.path === f.path;
              return (
                <div
                  key={f.path}
                  onClick={() => onSelectFile(f)}
                  className={`flex items-center gap-1.5 py-1 pr-2 text-xs font-mono cursor-pointer rounded transition ${
                    isSelected
                      ? "bg-[#E73F1E]/15 text-white font-semibold border-l-2 border-[#E73F1E]"
                      : "text-slate-300 hover:text-white hover:bg-[#181C24]"
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                >
                  <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-[#E73F1E]" : "text-slate-500"}`} />
                  <span className="truncate">{f.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ width: width ? `${width}px` : undefined }}
      className={`${width ? "" : "w-56"} shrink-0 h-full bg-[#12151B] border-r border-[#232936] flex flex-col select-none`}
    >
      {/* Explorer Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#232936]">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold">
          Workspace Files
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setIsCreatingFile(true);
              setIsCreatingFolder(false);
            }}
            title="New File"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsCreatingFolder(true);
              setIsCreatingFile(false);
            }}
            title="New Folder"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          {onRefresh && (
            <button
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              title="Refresh Files"
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] active:scale-90 active:rotate-180 active:text-[#E73F1E] active:bg-[#232936] transition-all duration-200 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 transition-transform duration-300 ${
                  isRefreshing ? "animate-spin text-[#E73F1E]" : ""
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* New File Inline Prompt */}
      {isCreatingFile && (
        <form onSubmit={handleCreateFileSubmit} className="p-2 border-b border-[#232936] flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-[#E73F1E] shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="filename.ext"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onBlur={() => {
              if (!newFileName.trim()) setIsCreatingFile(false);
            }}
            className="w-full bg-[#0B0D11] border border-[#E73F1E] rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none font-mono"
          />
        </form>
      )}

      {/* New Folder Inline Prompt */}
      {isCreatingFolder && (
        <form onSubmit={handleCreateFolderSubmit} className="p-2 border-b border-[#232936] flex items-center gap-1.5">
          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={() => {
              if (!newFolderName.trim()) setIsCreatingFolder(false);
            }}
            className="w-full bg-[#0B0D11] border border-amber-500 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none font-mono"
          />
        </form>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs font-mono text-slate-500">
            No files in workspace
          </div>
        ) : (
          renderDirectory(tree)
        )}
      </div>
    </div>
  );
}
