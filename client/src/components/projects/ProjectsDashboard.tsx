"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import {
  Plus,
  Search,
  FolderGit2,
  ArrowRight,
  LogOut,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Clock,
  ExternalLink,
  Code2,
} from "lucide-react";
import { generateReplId } from "@/lib/repl";

interface ProjectItem {
  id: string;
  name: string;
  repl_id: string;
  language: string;
  status: string;
  created_at?: string | Date;
  run_command?: string;
  port?: number;
}

interface ProjectsDashboardProps {
  initialProjects: ProjectItem[];
  user: {
    userId: string;
    email: string;
    name: string;
  };
}

export default function ProjectsDashboard({ initialProjects, user }: ProjectsDashboardProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>(initialProjects);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState(generateReplId());
  const [selectedLanguage, setSelectedLanguage] = useState<"node-js" | "python">("node-js");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await axios.get("/api/projects");
      setProjects(res.data?.projects || []);
    } catch (err) {
      console.warn("Failed to refresh projects:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post("/api/auth/logout");
      localStorage.removeItem("vessel_user");
      window.location.href = "/signin";
    } catch {
      window.location.href = "/signin";
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    const name = newProjectName.trim() || generateReplId();
    setIsCreating(true);

    try {
      const res = await axios.post("/api/projects", {
        name,
        language: selectedLanguage,
      });

      const newProj = res.data?.project;
      if (newProj) {
        setProjects((prev) => [newProj, ...prev]);
        setIsCreateOpen(false);
        router.push(`/projects/${encodeURIComponent(newProj.repl_id)}?lang=${encodeURIComponent(newProj.language)}`);
      }
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (project: ProjectItem) => {
    if (!confirm(`Are you sure you want to delete "${project.name}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingId(project.id);
    try {
      await axios.delete(`/api/projects/${project.id}`);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.repl_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.language.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0B0D11] text-white flex flex-col font-sans select-none">
      {/* Top Header */}
      <header className="h-16 border-b border-[#232936] px-6 sm:px-12 flex items-center justify-between sticky top-0 bg-[#0B0D11]/95 z-40 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-white p-1 flex items-center justify-center border border-slate-200 shadow-sm shrink-0 overflow-hidden group-hover:scale-105 transition">
              <img src="/vessel-logo.png" alt="Vessel Logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-semibold text-sm tracking-wide text-white font-mono">
              vessel.projects
            </span>
          </Link>
          <span className="text-xs text-slate-500 font-mono hidden sm:inline">/ App Router</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300 bg-[#12151B] border border-[#232936] px-3 py-1.5 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{user.name}</span>
          </div>

          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-2 text-slate-400 hover:text-[#E73F1E] hover:bg-[#181C24] border border-[#232936] rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {/* Controls Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Development Sandboxes
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Server-side fetched from PostgreSQL &bull; Ephemeral Docker compute &bull; Persistent S3
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2.5 text-slate-400 hover:text-white bg-[#12151B] border border-[#232936] rounded-xl hover:border-slate-600 transition"
              title="Refresh projects"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-[#E73F1E]" : ""}`} />
            </button>

            <button
              onClick={() => {
                setNewProjectName(generateReplId());
                setIsCreateOpen(true);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-[#E73F1E] hover:bg-[#ff4d29] text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#E73F1E]/20 transition active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>New Project</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search projects by name, repl ID, or language..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#12151B] border border-[#232936] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#E73F1E] transition"
          />
        </div>

        {/* Project Grid */}
        {filteredProjects.length === 0 ? (
          <div className="text-center py-16 px-4 border border-[#232936] rounded-2xl bg-[#12151B]/50">
            <FolderGit2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-200">No projects found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery ? "No workspaces match your query." : "Get started by creating your first isolated cloud sandbox."}
            </p>
            {!searchQuery && (
              <button
                onClick={() => {
                  setNewProjectName(generateReplId());
                  setIsCreateOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#E73F1E] hover:bg-[#ff4d29] text-white text-xs font-semibold rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Workspace</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((p) => {
              const isPython = p.language === "python";
              const isRunning = p.status === "RUNNING";

              return (
                <div
                  key={p.id}
                  className="bg-[#12151B] border border-[#232936] hover:border-slate-600 rounded-xl p-5 flex flex-col justify-between transition group relative"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                            isPython
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          }`}
                        >
                          {p.language}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase flex items-center gap-1 ${
                            isRunning
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-slate-800 text-slate-400 border border-slate-700"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
                          {p.status || "STOPPED"}
                        </span>
                      </div>

                      <button
                        onClick={() => handleDeleteProject(p)}
                        disabled={deletingId === p.id}
                        title="Delete project"
                        className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-[#181C24] transition opacity-0 group-hover:opacity-100"
                      >
                        {deletingId === p.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <h3 className="font-semibold text-sm text-white group-hover:text-[#E73F1E] transition mb-1 truncate">
                      {p.name}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-400 truncate mb-4">
                      ID: {p.repl_id}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-[#1C212B] flex items-center justify-between">
                    <span suppressHydrationWarning className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : "Recent"}
                    </span>

                    <Link
                      href={`/projects/${encodeURIComponent(p.repl_id)}?lang=${encodeURIComponent(p.language)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#181C24] hover:bg-[#E73F1E] text-slate-200 hover:text-white border border-[#232936] hover:border-[#E73F1E] rounded-lg text-xs font-semibold transition"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#12151B] border border-[#232936] rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">Create New Sandbox</h2>
            <p className="text-xs text-slate-400 mb-5 font-mono">
              Provisions a fresh Docker container with runtime & template
            </p>

            {createError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Workspace Name
                </label>
                <input
                  type="text"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. hyper-runner-core"
                  className="w-full bg-[#0B0D11] border border-[#232936] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#E73F1E] font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Runtime Environment
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage("node-js")}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-2.5 ${
                      selectedLanguage === "node-js"
                        ? "bg-[#E73F1E]/10 border-[#E73F1E] text-white"
                        : "bg-[#0B0D11] border-[#232936] text-slate-400 hover:text-white"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <div>
                      <div className="text-xs font-bold font-mono">Node.js 20</div>
                      <div className="text-[10px] text-slate-500">Express &bull; Web</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedLanguage("python")}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-2.5 ${
                      selectedLanguage === "python"
                        ? "bg-[#E73F1E]/10 border-[#E73F1E] text-white"
                        : "bg-[#0B0D11] border-[#232936] text-slate-400 hover:text-white"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <div>
                      <div className="text-xs font-bold font-mono">Python 3</div>
                      <div className="text-[10px] text-slate-500">HTTP &bull; Script</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-5 py-2 bg-[#E73F1E] hover:bg-[#ff4d29] text-white text-xs font-semibold rounded-lg shadow transition flex items-center gap-2"
                >
                  {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isCreating ? "Provisioning..." : "Create Project"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
