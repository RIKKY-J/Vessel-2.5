import { S3 } from "aws-sdk"
import fs from "fs";
import path from "path";

const s3 = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    s3ForcePathStyle: true,
})
export const fetchS3Folder = async (key: string, localPath: string): Promise<void> => {
    const cleanKey = key.replace(/\/+$/, "");
    const params = {
        Bucket: process.env.S3_BUCKET ?? "",
        Prefix: cleanKey
    }

    const response = await s3.listObjectsV2(params).promise()
    if (response.Contents && response.Contents.length > 0) {
        for (const file of response.Contents) {
            const fileKey = file.Key
            if (fileKey) {
                const relPath = fileKey.slice(cleanKey.length).replace(/^\/+/, "");
                if (!relPath) continue;
                const filePath = path.join(localPath, relPath);
                const getParams = {
                    Bucket: process.env.S3_BUCKET ?? "",
                    Key: fileKey
                }
                const data = await s3.getObject(getParams).promise()
                if (data.Body) {
                    await writeFile(filePath, data.Body as Buffer)
                }
            }
        }
    }
}

function writeFile(filePath: string, fileData: Buffer): Promise<void> {
    return new Promise(async (resolve, reject) => {
        await createFolder(path.dirname(filePath));

        fs.writeFile(filePath, fileData, (err) => {
            if (err) {
                reject(err)
            } else {
                resolve()
            }
        })
    });
}

function createFolder(dirName: string) {
    return new Promise<void>((resolve, reject) => {
        fs.mkdir(dirName, { recursive: true }, (err) => {
            if (err) {
                return reject(err)
            }
            resolve()
        });
    })
}

export const saveToS3 = async (key: string, filePath: string, content: string): Promise<void> => {
    const cleanKey = key.replace(/\/+$/, "");
    const cleanPath = filePath.replace(/^\/+/, "");
    const params = {
        Bucket: process.env.S3_BUCKET ?? "",
        Key: `${cleanKey}/${cleanPath}`,
        Body: content
    }

    await s3.putObject(params).promise()
}

const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    ".cache",
    ".next",
    "__pycache__",
    ".venv",
    "venv"
]);

export const saveFolderToS3 = async (localDir: string, s3Prefix: string): Promise<void> => {
    const cleanPrefix = s3Prefix.replace(/\/+$/, "");
    const bucket = process.env.S3_BUCKET ?? "";

    async function scanAndUpload(currentDir: string, relPath: string = "") {
        if (!fs.existsSync(currentDir)) return;
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name)) {
                    continue;
                }
                await scanAndUpload(fullPath, entryRel);
            } else if (entry.isFile()) {
                try {
                    const fileData = await fs.promises.readFile(fullPath);
                    const s3Key = `${cleanPrefix}/${entryRel}`;
                    await s3.putObject({
                        Bucket: bucket,
                        Key: s3Key,
                        Body: fileData
                    }).promise();
                    console.log(`[S3 Sync] Uploaded ${entryRel} -> ${s3Key}`);
                } catch (fileErr) {
                    console.warn(`[S3 Sync] Failed to upload ${entryRel}:`, fileErr);
                }
            }
        }
    }

    console.log(`[S3 Sync] Starting full sync of ${localDir} to s3://${bucket}/${cleanPrefix}...`);
    await scanAndUpload(localDir);
    console.log(`[S3 Sync] Full sync of ${localDir} completed.`);
};