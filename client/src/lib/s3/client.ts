import { S3 } from "aws-sdk";

let s3Client: S3 | null = null;

export function getS3Client(): S3 {
  if (s3Client) return s3Client;

  const endpoint = process.env.S3_ENDPOINT;
  const isCustomEndpoint = endpoint && !endpoint.includes("amazonaws.com");

  const config: S3.ClientConfiguration = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || "ap-southeast-2",
  };

  if (isCustomEndpoint) {
    config.endpoint = endpoint;
    config.s3ForcePathStyle = true;
  } else if (endpoint) {
    config.endpoint = endpoint;
    config.s3ForcePathStyle = false;
  }

  s3Client = new S3(config);
  return s3Client;
}

export function getS3Bucket(): string {
  return process.env.S3_BUCKET || "vessel-storage";
}

export function normalizeLanguage(lang?: string): string {
  const l = (lang || "").toLowerCase().trim();
  if (l === "python" || l === "py" || l === "python3") return "python";
  if (l === "node" || l === "node-js" || l === "nodejs" || l === "javascript" || l === "js") return "node-js";
  return l || "node-js";
}
