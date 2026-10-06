"use client";

import React, { useMemo, useRef, useEffect } from "react";
import MonacoEditor from "@monaco-editor/react";
import { Loader2, Code2 } from "lucide-react";
import { File } from "./file-manager";

interface EditorProps {
  selectedFile: File | undefined;
  onChange: (value: string) => void;
}

export default function Editor({ selectedFile, onChange }: EditorProps) {
  const editorRef = useRef<any>(null);

  const language = useMemo(() => {
    if (!selectedFile) return "javascript";
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
      case "jsx":
      case "mjs":
      case "cjs":
        return "javascript";
      case "ts":
      case "tsx":
        return "typescript";
      case "py":
        return "python";
      case "json":
        return "json";
      case "html":
      case "htm":
        return "html";
      case "css":
        return "css";
      case "md":
        return "markdown";
      case "sh":
        return "shell";
      case "sql":
        return "sql";
      default:
        return "plaintext";
    }
  }, [selectedFile]);

  // Sync external content changes (e.g. from disk refresh or another user) into Monaco
  useEffect(() => {
    if (editorRef.current && selectedFile && selectedFile.content !== undefined) {
      const currentVal = editorRef.current.getValue();
      if (currentVal !== selectedFile.content) {
        editorRef.current.setValue(selectedFile.content);
      }
    }
  }, [selectedFile?.content, selectedFile?.path]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  if (!selectedFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0D11] text-slate-500 font-mono text-xs">
        <Code2 className="w-10 h-10 mb-2 text-slate-700" />
        <p>No file selected</p>
        <p className="text-[10px] text-slate-600 mt-1">Select a file from the explorer to begin editing</p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full w-full bg-[#0B0D11] relative overflow-hidden">
      <MonacoEditor
        height="100%"
        language={language}
        path={selectedFile.path}
        value={selectedFile.content ?? ""}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        onChange={(val) => onChange(val ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
          fontLigatures: true,
          cursorBlinking: "smooth",
          smoothScrolling: true,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
        }}
        loading={
          <div className="flex-1 flex items-center justify-center bg-[#0B0D11] text-slate-300 font-mono text-xs">
            <Loader2 className="w-5 h-5 animate-spin mr-2 text-[#E73F1E]" />
            Loading Monaco Editor...
          </div>
        }
      />
    </div>
  );
}
