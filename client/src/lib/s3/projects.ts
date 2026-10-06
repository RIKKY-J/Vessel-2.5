import { getS3Client, getS3Bucket } from "./client";
import { S3 } from "aws-sdk";
import fs from "fs";
import path from "path";

export interface ProjectFile {
  type: "file" | "dir";
  name: string;
  path: string;
  content?: string;
}

export function getLocalWorkspaceDir(replId: string): string {
  const baseDir = process.env.VESSEL_WORKSPACES_DIR || path.join(process.cwd(), "data", "workspaces");
  return path.join(baseDir, replId);
}

export async function readLocalProjectFiles(replId: string): Promise<ProjectFile[]> {
  const localDir = getLocalWorkspaceDir(replId);
  const files: ProjectFile[] = [];

  if (!fs.existsSync(localDir)) {
    return files;
  }

  async function scan(currentDir: string, relPrefix: string = "") {
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          files.push({
            type: "dir",
            name: entry.name,
            path: relPath,
          });
          await scan(fullPath, relPath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.promises.readFile(fullPath, "utf-8");
            files.push({
              type: "file",
              name: entry.name,
              path: relPath,
              content,
            });
          } catch {}
        }
      }
    } catch {}
  }

  await scan(localDir);
  return files;
}

export async function createProjectFolder(replId: string, folderPath: string): Promise<void> {
  const cleanPath = folderPath.replace(/^\/+/, "");
  const localDir = getLocalWorkspaceDir(replId);
  const fullPath = path.join(localDir, cleanPath);
  await fs.promises.mkdir(fullPath, { recursive: true });
}

export async function checkProjectExistsInS3(replId: string): Promise<boolean> {
  // Check local disk first
  const localFiles = await readLocalProjectFiles(replId);
  if (localFiles.length > 0) return true;

  try {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: `code/${replId}/`, MaxKeys: 1 }).promise();
    return Boolean(list.Contents && list.Contents.length > 0);
  } catch (err) {
    return false;
  }
}

export async function fetchProjectFiles(replId: string): Promise<ProjectFile[]> {
  const localDir = getLocalWorkspaceDir(replId);

  // 1. Check local workspace disk first (authoritative and immediate for live containers)
  const localFiles = await readLocalProjectFiles(replId);
  if (localFiles.length > 0) {
    return localFiles;
  }

  // 2. Fallback to AWS S3 if not found locally (e.g. cold start on new server)
  const files: ProjectFile[] = [];
  try {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const prefix = `code/${replId}/`;
    let continuationToken: string | undefined = undefined;

    do {
      const resp: S3.ListObjectsV2Output = await s3
        .listObjectsV2({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
        .promise();

      if (resp.Contents && resp.Contents.length > 0) {
        for (const item of resp.Contents) {
          if (!item.Key) continue;
          const relPath = item.Key.substring(prefix.length).replace(/^\/+/, "");
          if (!relPath || relPath.endsWith("/")) continue;

          try {
            const obj = await s3.getObject({ Bucket: bucket, Key: item.Key }).promise();
            const content = obj.Body ? obj.Body.toString("utf-8") : "";
            const parts = relPath.split("/");
            const name = parts[parts.length - 1];

            files.push({
              type: "file",
              name,
              path: relPath,
              content,
            });

            // Mirror to local disk cache
            try {
              const fullLocalPath = path.join(localDir, relPath);
              await fs.promises.mkdir(path.dirname(fullLocalPath), { recursive: true });
              await fs.promises.writeFile(fullLocalPath, content, "utf-8");
            } catch {}
          } catch (fetchErr) {
            console.warn(`[S3] Failed to read object ${item.Key}:`, fetchErr);
          }
        }
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    if (files.length > 0) {
      return files;
    }
  } catch (err: any) {
    console.warn(`[S3] fetchProjectFiles error for ${replId} (${err.message}). Reading local workspace cache...`);
  }

  return readLocalProjectFiles(replId);
}

export async function saveProjectFile(replId: string, filePath: string, content: string): Promise<void> {
  const cleanPath = filePath.replace(/^\/+/, "");

  // 1. Immediately save to local disk store
  try {
    const localDir = getLocalWorkspaceDir(replId);
    const fullPath = path.join(localDir, cleanPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, "utf-8");
  } catch (localErr) {
    console.warn(`[Disk] Error writing local workspace file ${filePath}:`, localErr);
  }

  // 2. Asynchronously upload to S3
  try {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const key = `code/${replId}/${cleanPath}`;

    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      })
      .promise();
  } catch (s3Err: any) {
    console.warn(`[S3] Upload warning for ${filePath}: ${s3Err.message}`);
  }
}

export async function syncFilesToS3(replId: string, files: { path: string; content: string }[]): Promise<void> {
  await Promise.all(
    files.map((file) => saveProjectFile(replId, file.path, file.content))
  );
}

export async function deleteProjectFiles(replId: string): Promise<void> {
  // Delete from local disk
  try {
    const localDir = getLocalWorkspaceDir(replId);
    if (fs.existsSync(localDir)) {
      await fs.promises.rm(localDir, { recursive: true, force: true });
    }
  } catch {}

  // Delete from S3
  try {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const prefix = `code/${replId}/`;
    const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: prefix }).promise();
    if (list.Contents && list.Contents.length > 0) {
      const objects = list.Contents.map((c) => ({ Key: c.Key! }));
      await s3
        .deleteObjects({
          Bucket: bucket,
          Delete: { Objects: objects },
        })
        .promise();
    }
  } catch (err: any) {
    console.warn(`[S3] deleteProjectFiles error for ${replId}:`, err.message);
  }
}
