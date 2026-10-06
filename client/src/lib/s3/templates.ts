import { getS3Client, getS3Bucket, normalizeLanguage } from "./client";
import { saveProjectFile } from "./projects";
import fs from "fs";
import path from "path";

// Starter templates for offline / local development fallback
const FALLBACK_STARTERS: Record<string, { name: string; path: string; content: string }[]> = {
  "node-js": [
    {
      name: "index.js",
      path: "index.js",
      content: `const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send(\`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Vessel App</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0B0D11;
            color: #FFFFFF;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background: #12151B;
            border: 1px solid #232936;
            padding: 2.5rem;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          }
          h1 { color: #E73F1E; margin-bottom: 0.5rem; }
          p { color: #94A3B8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🚀 Vessel Container is Live!</h1>
          <p>Your Node.js web application is running on port \${port}.</p>
          <p>Edit <code>index.js</code> and watch it auto-reload!</p>
        </div>
      </body>
    </html>
  \`);
});

app.listen(port, () => {
  console.log(\`[Server] Web application running at http://localhost:\${port}\`);
});
`,
    },
    {
      name: "package.json",
      path: "package.json",
      content: JSON.stringify(
        {
          name: "vessel-nodejs-sandbox",
          version: "1.0.0",
          main: "index.js",
          scripts: {
            start: "node --watch index.js",
            dev: "node --watch index.js",
          },
          dependencies: {
            express: "^4.18.2",
            cors: "^2.8.5",
          },
        },
        null,
        2
      ),
    },
  ],
  python: [
    {
      name: "main.py",
      path: "main.py",
      content: `from http.server import HTTPServer, BaseHTTPRequestHandler
import sys

PORT = 3000

class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.end_headers()
        html = """
        <!DOCTYPE html>
        <html>
          <head>
            <title>Vessel Python App</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #0B0D11;
                color: #FFFFFF;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              .card {
                background: #12151B;
                border: 1px solid #232936;
                padding: 2.5rem;
                border-radius: 12px;
                text-align: center;
              }
              h1 { color: #E73F1E; }
              p { color: #94A3B8; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>🐍 Vessel Python Server Live!</h1>
              <p>Your Python HTTP server is serving requests on port 3000.</p>
            </div>
          </body>
        </html>
        """
        self.wfile.write(html.encode('utf-8'))

if __name__ == '__main__':
    print(f"[Python] Server started on port {PORT}")
    server = HTTPServer(('0.0.0.0', PORT), SimpleHandler)
    server.serve_forever()
`,
    },
  ],
};

export async function copyTemplateToProject(language: string, replId: string): Promise<void> {
  const normLang = normalizeLanguage(language);

  // 1. Check local templates folder on disk (both ../templates and ./templates)
  const candidateDirs = [
    path.resolve(process.cwd(), "..", "templates", normLang),
    path.resolve(process.cwd(), "templates", normLang),
    path.resolve(process.cwd(), "..", "..", "templates", normLang),
  ];

  let localTemplateDir: string | null = null;
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      localTemplateDir = dir;
      break;
    }
  }

  if (localTemplateDir) {
    try {
      const entries = await fs.promises.readdir(localTemplateDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const content = await fs.promises.readFile(path.join(localTemplateDir, entry.name), "utf-8");
          await saveProjectFile(replId, entry.name, content);
        }
      }
      return;
    } catch (diskErr) {
      console.warn(`[Templates] Error reading from ${localTemplateDir}:`, diskErr);
    }
  }

  // 2. Try AWS S3 base template copy
  try {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const sourcePrefix = `base/${normLang}/`;
    const destPrefix = `code/${replId}/`;
    const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: sourcePrefix }).promise();
    if (list.Contents && list.Contents.length > 0) {
      await Promise.all(
        list.Contents.map(async (object) => {
          if (!object.Key) return;
          const relPath = object.Key.slice(sourcePrefix.length).replace(/^\/+/, "");
          if (!relPath) return;
          const destKey = `${destPrefix}${relPath}`;
          await s3
            .copyObject({
              Bucket: bucket,
              CopySource: `${bucket}/${object.Key}`,
              Key: destKey,
            })
            .promise();
        })
      );
      return;
    }
  } catch (err: any) {
    console.warn(`[S3] copyTemplateToProject S3 copy failed:`, err.message);
  }

  // 3. Built-in hardcoded starter fallback
  const starters = FALLBACK_STARTERS[normLang] || FALLBACK_STARTERS["node-js"];
  for (const file of starters) {
    try {
      await saveProjectFile(replId, file.path, file.content);
    } catch (saveErr) {
      console.warn(`[Templates] Fallback save failed for ${file.path}:`, saveErr);
    }
  }
}
