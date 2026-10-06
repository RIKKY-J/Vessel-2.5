export enum Type {
  FILE = 0,
  DIRECTORY = 1,
  DUMMY = 2,
}

export interface File {
  id: string;
  name: string;
  path: string;
  content?: string;
  parentId: string | undefined;
  depth: number;
  type: Type;
}

export interface RemoteFile {
  type: "file" | "dir";
  name: string;
  path: string;
  content?: string;
}

export interface Directory {
  id: string;
  name: string;
  path: string;
  parentId: string | undefined;
  depth: number;
  type: Type;
  files: File[];
  dirs: Directory[];
}

export function buildFileTree(data: RemoteFile[]): Directory {
  const dirs = data.filter((x) => x.type === "dir");
  const files = data.filter((x) => x.type === "file");
  const cache = new Map<string, Directory | File>();

  const rootDir: Directory = {
    id: "root",
    name: "root",
    parentId: undefined,
    type: Type.DIRECTORY,
    path: "",
    depth: 0,
    dirs: [],
    files: [],
  };

  const normalizePath = (p: string) => p.replace(/^\/+/, "").replace(/\\/g, "/");

  dirs.forEach((item) => {
    const rel = normalizePath(item.path);
    const isRoot = !rel.includes("/");
    const parentPath = isRoot ? "0" : rel.split("/").slice(0, -1).join("/");
    const dir: Directory = {
      id: item.path,
      name: item.name,
      path: item.path,
      parentId: isRoot ? "0" : dirs.find((x) => normalizePath(x.path) === parentPath)?.path || "0",
      type: Type.DIRECTORY,
      depth: 0,
      dirs: [],
      files: [],
    };
    cache.set(dir.id, dir);
  });

  files.forEach((item) => {
    const rel = normalizePath(item.path);
    const isRoot = !rel.includes("/");
    const parentPath = isRoot ? "0" : rel.split("/").slice(0, -1).join("/");
    const file: File = {
      id: item.path,
      name: item.name,
      path: item.path,
      parentId: isRoot ? "0" : dirs.find((x) => normalizePath(x.path) === parentPath)?.path || "0",
      type: Type.FILE,
      depth: 0,
      content: item.content ?? "",
    };
    cache.set(file.id, file);
  });

  cache.forEach((value) => {
    if (value.parentId === "0") {
      if (value.type === Type.DIRECTORY) rootDir.dirs.push(value as Directory);
      else rootDir.files.push(value as File);
    } else {
      const parentDir = cache.get(value.parentId as string) as Directory;
      if (parentDir) {
        if (value.type === Type.DIRECTORY) parentDir.dirs.push(value as Directory);
        else parentDir.files.push(value as File);
      } else {
        if (value.type === Type.DIRECTORY) rootDir.dirs.push(value as Directory);
        else rootDir.files.push(value as File);
      }
    }
  });

  getDepth(rootDir, 0);
  return rootDir;
}

function getDepth(rootDir: Directory, curDepth: number) {
  rootDir.files.forEach((file) => {
    file.depth = curDepth + 1;
  });
  rootDir.dirs.forEach((dir) => {
    dir.depth = curDepth + 1;
    getDepth(dir, curDepth + 1);
  });
}

export function findFileByName(rootDir: Directory, filename: string): File | undefined {
  let targetFile: File | undefined = undefined;

  function findFile(root: Directory, name: string) {
    for (const file of root.files) {
      if (file.name === name) {
        targetFile = file;
        return;
      }
    }
    for (const dir of root.dirs) {
      findFile(dir, name);
    }
  }

  findFile(rootDir, filename);
  return targetFile;
}
