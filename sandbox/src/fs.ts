import fs from "fs";
import path from "path";

interface File {
    type: "file" | "dir";
    name: string;
    path: string;
}

export function seedWorkspaceFiles(language: string = "node-js") {
    try {
        if (!fs.existsSync("/workspace")) {
            fs.mkdirSync("/workspace", { recursive: true });
        }
        const entries = fs.readdirSync("/workspace").filter((f) => f !== "node_modules" && f !== ".git");
        if (entries.length > 0) return;

        console.log(`[fs] Seeding starter files for language: ${language}`);
        if (language === "python") {
            const pyContent = `from http.server import HTTPServer, BaseHTTPRequestHandler
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
`;
            fs.writeFileSync("/workspace/main.py", pyContent, "utf8");
        } else {
            const jsContent = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

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
`;
            const pkgContent = JSON.stringify(
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
            );
            fs.writeFileSync("/workspace/index.js", jsContent, "utf8");
            fs.writeFileSync("/workspace/package.json", pkgContent, "utf8");
        }
        console.log("[fs] Starter files successfully seeded in /workspace");
    } catch (err: any) {
        console.warn("[fs] seedWorkspaceFiles warning:", err?.message || err);
    }
}

export const fetchDir = (dir: string, baseDir: string): Promise<File[]> => {
    return new Promise((resolve) => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch {}
            return resolve([]);
        }

        fs.readdir(dir, { withFileTypes: true }, (err, files) => {
            if (err) {
                console.warn(`[fs] fetchDir warning for ${dir}:`, err.message);
                return resolve([]);
            }

            resolve(
                files
                    .filter((file) => file.name !== "node_modules" && file.name !== ".git" && file.name !== ".cache")
                    .map((file) => ({
                        type: file.isDirectory() ? "dir" : "file",
                        name: file.name,
                        path: `${baseDir ? baseDir + "/" : ""}${file.name}`,
                    }))
            );
        });
    });
};

export const fetchFileContent = (file: string): Promise<string> => {
    return new Promise((resolve) => {
        if (!fs.existsSync(file)) {
            return resolve("");
        }

        fs.readFile(file, "utf8", (err, data) => {
            if (err) {
                console.warn(`[fs] fetchFileContent warning for ${file}:`, err.message);
                return resolve("");
            }
            resolve(data);
        });
    });
};

export const saveFile = async (file: string, content: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch {}
        }

        fs.writeFile(file, content, "utf8", (err) => {
            if (err) {
                console.warn(`[fs] saveFile warning for ${file}:`, err.message);
                return reject(err);
            }
            resolve();
        });
    });
};