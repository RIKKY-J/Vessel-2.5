export enum FileType {
  FILE = 0,
  DIRECTORY = 1,
  DUMMY = 2,
}

export interface FileItem {
  id: string;
  name: string;
  path: string;
  content?: string;
  parentId: string | undefined;
  depth: number;
  type: FileType;
}

export interface RemoteFile {
  type: "file" | "dir";
  name: string;
  path: string;
  content?: string;
}

export interface DirectoryItem {
  id: string;
  name: string;
  path: string;
  parentId: string | undefined;
  depth: number;
  type: FileType;
  files: FileItem[];
  dirs: DirectoryItem[];
}

export interface UserSession {
  userId: string;
  email: string;
  name: string;
}

export interface ProjectMetadata {
  id: string;
  user_id: string;
  name: string;
  repl_id: string;
  language: string;
  status: string;
  created_at?: string | Date;
  updated_at?: string | Date;
  run_command?: string;
  port?: number;
}
