import { prisma } from "./prisma";
import crypto from "crypto";

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at?: Date | string;
}

export interface DbProject {
  id: string;
  user_id: string;
  name: string;
  repl_id: string;
  language: string;
  status: string;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface DbProjectSettings {
  project_id: string;
  run_command: string;
  port: number;
}

// In-memory fallback store when PostgreSQL is offline during local dev/testing
class MemoryStore {
  users: Map<string, DbUser> = new Map();
  projects: Map<string, DbProject> = new Map();
  settings: Map<string, DbProjectSettings> = new Map();

  async findUserByEmail(email: string): Promise<DbUser | null> {
    const clean = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase().trim() === clean) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<DbUser | null> {
    return this.users.get(id) || null;
  }

  async createUser(user: DbUser): Promise<DbUser> {
    this.users.set(user.id, user);
    return user;
  }

  async findProjectsByUserId(userId: string): Promise<DbProject[]> {
    const list: DbProject[] = [];
    for (const p of this.projects.values()) {
      if (p.user_id === userId) list.push(p);
    }
    return list.sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  }

  async findProjectByReplId(replId: string): Promise<DbProject | null> {
    for (const p of this.projects.values()) {
      if (p.repl_id === replId) return p;
    }
    return null;
  }

  async findProjectById(id: string): Promise<DbProject | null> {
    return this.projects.get(id) || null;
  }

  async createProject(project: DbProject, settings?: Partial<DbProjectSettings>): Promise<DbProject> {
    this.projects.set(project.id, project);
    const defaultCmd = project.language === "python" ? "python3 main.py" : "node --watch index.js";
    this.settings.set(project.id, {
      project_id: project.id,
      run_command: settings?.run_command || defaultCmd,
      port: settings?.port || 3000,
    });
    return project;
  }

  async updateProjectStatus(replId: string, status: string): Promise<void> {
    const p = await this.findProjectByReplId(replId);
    if (p) {
      p.status = status;
      p.updated_at = new Date();
    }
  }

  async getProjectSettings(projectId: string): Promise<DbProjectSettings | null> {
    return this.settings.get(projectId) || null;
  }

  async updateProjectSettings(projectId: string, settings: Partial<DbProjectSettings>): Promise<void> {
    const current = this.settings.get(projectId) || {
      project_id: projectId,
      run_command: "node --watch index.js",
      port: 3000,
    };
    this.settings.set(projectId, { ...current, ...settings });
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    this.settings.delete(id);
  }

  async claimProject(replId: string, newUserId: string): Promise<boolean> {
    const p = await this.findProjectByReplId(replId);
    if (p) {
      p.user_id = newUserId;
      p.updated_at = new Date();
      return true;
    }
    return false;
  }
}

const memoryStore = new MemoryStore();
let postgresConnected: boolean | null = null;

async function isPostgresAvailable(): Promise<boolean> {
  if (postgresConnected !== null) return postgresConnected;
  try {
    // Quick test query to verify PostgreSQL connection
    await prisma.$queryRaw`SELECT 1`;
    postgresConnected = true;
    console.log("[DB] Connected to PostgreSQL via Prisma.");
    return true;
  } catch (err: any) {
    console.warn(`[DB] PostgreSQL not reachable (${err.message}). Using in-memory fallback store.`);
    postgresConnected = false;
    return false;
  }
}

// Repositories / Data Access with Prisma
export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const clean = email.toLowerCase().trim();
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const user = await prisma.user.findUnique({
        where: { email: clean },
      });
      if (user) {
        return {
          id: user.id,
          email: user.email,
          password_hash: user.password_hash,
          name: user.name || user.email.split("@")[0],
          created_at: user.created_at,
        };
      }
      return null;
    } catch (err) {
      console.warn("[DB] Prisma findUserByEmail error, falling back to memory:", err);
    }
  }

  return memoryStore.findUserByEmail(clean);
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
      });
      if (user) {
        return {
          id: user.id,
          email: user.email,
          password_hash: user.password_hash,
          name: user.name || user.email.split("@")[0],
          created_at: user.created_at,
        };
      }
      return null;
    } catch (err) {
      console.warn("[DB] Prisma findUserById error, falling back to memory:", err);
    }
  }

  return memoryStore.findUserById(id);
}

export async function createUser(data: { email: string; password_hash: string; name?: string }): Promise<DbUser> {
  const clean = data.email.toLowerCase().trim();
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const user = await prisma.user.create({
        data: {
          email: clean,
          password_hash: data.password_hash,
          name: data.name || clean.split("@")[0],
        },
      });
      return {
        id: user.id,
        email: user.email,
        password_hash: user.password_hash,
        name: user.name || clean.split("@")[0],
        created_at: user.created_at,
      };
    } catch (err) {
      console.warn("[DB] Prisma createUser error, falling back to memory:", err);
    }
  }

  const id = crypto.randomUUID();
  return memoryStore.createUser({
    id,
    email: clean,
    password_hash: data.password_hash,
    name: data.name || clean.split("@")[0],
    created_at: new Date(),
  });
}

export async function findProjectsByUserId(userId: string): Promise<(DbProject & { run_command?: string; port?: number })[]> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const projects = await prisma.project.findMany({
        where: { user_id: userId },
        include: { settings: true },
        orderBy: { created_at: "desc" },
      });

      return projects.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        name: p.name,
        repl_id: p.repl_id,
        language: p.language,
        status: p.status,
        created_at: p.created_at,
        updated_at: p.updated_at,
        run_command: p.settings?.run_command,
        port: p.settings?.port,
      }));
    } catch (err) {
      console.warn("[DB] Prisma findProjectsByUserId error, falling back to memory:", err);
    }
  }

  const projects = await memoryStore.findProjectsByUserId(userId);
  return Promise.all(
    projects.map(async (p) => {
      const s = await memoryStore.getProjectSettings(p.id);
      return {
        ...p,
        run_command: s?.run_command,
        port: s?.port,
      };
    })
  );
}

export async function findProjectByReplId(replId: string): Promise<(DbProject & { run_command?: string; port?: number }) | null> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const p = await prisma.project.findUnique({
        where: { repl_id: replId },
        include: { settings: true },
      });
      if (p) {
        return {
          id: p.id,
          user_id: p.user_id,
          name: p.name,
          repl_id: p.repl_id,
          language: p.language,
          status: p.status,
          created_at: p.created_at,
          updated_at: p.updated_at,
          run_command: p.settings?.run_command,
          port: p.settings?.port,
        };
      }
      return null;
    } catch (err) {
      console.warn("[DB] Prisma findProjectByReplId error, falling back to memory:", err);
    }
  }

  const p = await memoryStore.findProjectByReplId(replId);
  if (!p) return null;
  const s = await memoryStore.getProjectSettings(p.id);
  return {
    ...p,
    run_command: s?.run_command,
    port: s?.port,
  };
}

export async function findProjectById(id: string): Promise<(DbProject & { run_command?: string; port?: number }) | null> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const p = await prisma.project.findUnique({
        where: { id },
        include: { settings: true },
      });
      if (p) {
        return {
          id: p.id,
          user_id: p.user_id,
          name: p.name,
          repl_id: p.repl_id,
          language: p.language,
          status: p.status,
          created_at: p.created_at,
          updated_at: p.updated_at,
          run_command: p.settings?.run_command,
          port: p.settings?.port,
        };
      }
      return null;
    } catch (err) {
      console.warn("[DB] Prisma findProjectById error, falling back to memory:", err);
    }
  }

  const p = await memoryStore.findProjectById(id);
  if (!p) return null;
  const s = await memoryStore.getProjectSettings(p.id);
  return {
    ...p,
    run_command: s?.run_command,
    port: s?.port,
  };
}

export async function createProject(data: {
  userId: string;
  name: string;
  replId: string;
  language: string;
  runCommand?: string;
  port?: number;
}): Promise<DbProject> {
  const defaultCmd = data.language === "python" ? "python3 main.py" : "node --watch index.js";
  const runCmd = data.runCommand || defaultCmd;
  const port = data.port || 3000;
  const available = await isPostgresAvailable();

  if (available) {
    try {
      const p = await prisma.project.create({
        data: {
          user_id: data.userId,
          name: data.name,
          repl_id: data.replId,
          language: data.language || "node-js",
          status: "STOPPED",
          settings: {
            create: {
              run_command: runCmd,
              port,
            },
          },
        },
      });

      return {
        id: p.id,
        user_id: p.user_id,
        name: p.name,
        repl_id: p.repl_id,
        language: p.language,
        status: p.status,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    } catch (err) {
      console.warn("[DB] Prisma createProject error, falling back to memory:", err);
    }
  }

  const id = crypto.randomUUID();
  const project: DbProject = {
    id,
    user_id: data.userId,
    name: data.name,
    repl_id: data.replId,
    language: data.language || "node-js",
    status: "STOPPED",
    created_at: new Date(),
    updated_at: new Date(),
  };

  return memoryStore.createProject(project, { run_command: runCmd, port });
}

export async function updateProjectStatus(replId: string, status: string): Promise<void> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      await prisma.project.update({
        where: { repl_id: replId },
        data: { status },
      });
      return;
    } catch (err) {
      console.warn("[DB] Prisma updateProjectStatus error, falling back to memory:", err);
    }
  }

  await memoryStore.updateProjectStatus(replId, status);
}

export async function updateProjectSettings(projectId: string, settings: { run_command?: string; port?: number }): Promise<void> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      await prisma.projectSettings.upsert({
        where: { project_id: projectId },
        update: {
          run_command: settings.run_command,
          port: settings.port,
        },
        create: {
          project_id: projectId,
          run_command: settings.run_command || "node --watch index.js",
          port: settings.port || 3000,
        },
      });
      return;
    } catch (err) {
      console.warn("[DB] Prisma updateProjectSettings error, falling back to memory:", err);
    }
  }

  await memoryStore.updateProjectSettings(projectId, settings);
}

export async function deleteProject(id: string): Promise<void> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      await prisma.project.delete({
        where: { id },
      });
      return;
    } catch (err) {
      console.warn("[DB] Prisma deleteProject error, falling back to memory:", err);
    }
  }

  await memoryStore.deleteProject(id);
}

export async function claimProject(replId: string, newUserId: string): Promise<boolean> {
  const available = await isPostgresAvailable();

  if (available) {
    try {
      await prisma.project.update({
        where: { repl_id: replId },
        data: { user_id: newUserId },
      });
      return true;
    } catch (err) {
      console.warn("[DB] Prisma claimProject error, falling back to memory:", err);
    }
  }

  return memoryStore.claimProject(replId, newUserId);
}
