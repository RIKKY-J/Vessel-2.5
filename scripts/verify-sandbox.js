const path = require("path");
const fs = require("fs");

// Native .env parser without external dependencies
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Load env files in priority order
const envPaths = [
  path.resolve(__dirname, "../client/.env.local"),
  path.resolve(__dirname, "../client/.env"),
  path.resolve(__dirname, "../server/.env"),
  path.resolve(__dirname, "../.env"),
];

for (const envPath of envPaths) {
  loadEnvFile(envPath);
}

async function verify() {
  console.log("==========================================");
  console.log("Vessel Architecture Verification");
  console.log("Docker Sandboxes • PostgreSQL + Prisma • AWS S3");
  console.log("==========================================\n");

  // 1. Verify Templates
  console.log("1. Checking Local Boilerplate Templates...");
  const templates = ["node-js", "python"];
  for (const t of templates) {
    const p = path.resolve(__dirname, `../templates/${t}`);
    if (fs.existsSync(p)) {
      const files = fs.readdirSync(p);
      console.log(`  ✅ Template '${t}' present with ${files.length} files`);
    } else {
      console.warn(`  ⚠️ Template '${t}' missing at ${p}`);
    }
  }

  // 2. Verify Session Secret
  console.log("\n2. Checking Session Secret...");
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) {
    console.log(`  ✅ SESSION_SECRET configured (${secret.length} characters)`);
  } else if (secret) {
    console.warn(`  ⚠️ SESSION_SECRET is shorter than 32 characters (${secret.length} chars)`);
  } else {
    console.warn(`  ⚠️ SESSION_SECRET not set in .env or .env.local`);
  }

  // 3. Verify Database Config
  console.log("\n3. Checking PostgreSQL Database URL...");
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log(`  ✅ DATABASE_URL configured: ${dbUrl.replace(/:[^:@]+@/, ":****@")}`);
  } else {
    console.warn(`  ⚠️ DATABASE_URL not found in .env`);
  }

  // 4. Verify S3 Config
  console.log("\n4. Checking S3 Configuration...");
  const bucket = process.env.S3_BUCKET || "vessel-storage";
  const region = process.env.AWS_REGION || "us-east-1";
  console.log(`  Bucket: ${bucket}`);
  console.log(`  Region: ${region}`);

  // 5. Verify Docker Engine
  console.log("\n5. Checking Docker Engine Connectivity...");
  try {
    const possibleModuleDirs = [path.resolve(__dirname, "../frontend/node_modules")];
    for (const modDir of possibleModuleDirs) {
      if (fs.existsSync(modDir)) module.paths.unshift(modDir);
    }
    const Docker = require("dockerode");
    const docker = new Docker();
    const info = await docker.ping();
    console.log(`  ✅ Docker Engine reachable: ${info.toString()}`);
  } catch (err) {
    console.log(`  ℹ️ Docker daemon not active or not installed locally (Sandbox service will use dev fallback): ${err.message}`);
  }

  console.log("\n==========================================");
  console.log("✅ Verification Complete");
  console.log("==========================================");
}

verify().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
