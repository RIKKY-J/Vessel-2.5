const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");

// In-memory cache of active ECS tasks
const ecsTasks = new Map();

function getActiveSandboxesFilePath() {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return path.join(dir, "active-sandboxes.json");
}

function persistEcsSandbox(replId, info) {
  try {
    const file = getActiveSandboxesFilePath();
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}
    }
    data[replId] = {
      ...info,
      containerIp: info.taskIp,
      provider: "ecs",
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("[ECS] Error persisting sandbox:", err.message);
  }
}

function removePersistedEcsSandbox(replId) {
  try {
    const file = getActiveSandboxesFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data[replId];
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    }
  } catch {}
}

function isEcsConfigured() {
  if (process.env.SANDBOX_PROVIDER === "ecs") return true;
  if (process.env.SANDBOX_PROVIDER === "docker") return false;
  return !!(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    process.env.ECS_CLUSTER
  );
}

function getEcsClient() {
  return new AWS.ECS({
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
}

function getEc2Client() {
  return new AWS.EC2({
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
}

/**
 * Automatically discovers default subnets in the AWS Default VPC
 */
async function autoDiscoverSubnets(ec2) {
  try {
    const res = await ec2.describeSubnets({
      Filters: [{ Name: "default-for-az", Values: ["true"] }],
    }).promise();
    if (res.Subnets && res.Subnets.length > 0) {
      const subnets = res.Subnets.map((s) => s.SubnetId).filter(Boolean);
      console.log(`[ECS] Auto-discovered ${subnets.length} default VPC subnets:`, subnets.slice(0, 2));
      return subnets;
    }
  } catch (err) {
    console.warn("[ECS] Auto-discovering default subnets warning:", err.message);
  }
  return [];
}

/**
 * Automatically discovers the default security group in the default VPC
 */
async function autoDiscoverSecurityGroup(ec2) {
  try {
    const res = await ec2.describeSecurityGroups({
      Filters: [{ Name: "group-name", Values: ["default"] }],
    }).promise();
    if (res.SecurityGroups && res.SecurityGroups.length > 0) {
      const sg = res.SecurityGroups[0].GroupId;
      console.log(`[ECS] Auto-discovered default security group:`, sg);
      return [sg];
    }
  } catch (err) {
    console.warn("[ECS] Auto-discovering default security group warning:", err.message);
  }
  return [];
}

/**
 * Resolves the public or private IP of the running Fargate task
 */
async function resolveTaskIp(ecs, ec2, cluster, taskArn) {
  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const desc = await ecs.describeTasks({ cluster, tasks: [taskArn] }).promise();
    const task = desc.tasks?.[0];
    if (!task) throw new Error(`Task ${taskArn} not found in cluster ${cluster}`);

    const eniAttachment = task.attachments?.find((a) => a.type === "ElasticNetworkInterface");
    const eniIdDetail = eniAttachment?.details?.find((d) => d.name === "networkInterfaceId");
    const eniId = eniIdDetail?.value;

    if (eniId) {
      const netDesc = await ec2.describeNetworkInterfaces({ NetworkInterfaceIds: [eniId] }).promise();
      const iface = netDesc.NetworkInterfaces?.[0];
      const ip = iface?.Association?.PublicIp || iface?.PrivateIpAddress;
      if (ip) {
        return ip;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for ECS task network interface attachment.");
}

/**
 * Launches an isolated ECS Fargate sandbox task
 */
async function createEcsSandbox({ replId, language = "node-js" }) {
  const cluster = process.env.ECS_CLUSTER || "vessel-cluster";
  const taskDef = process.env.ECS_TASK_DEFINITION || process.env.ECS_TASK_DEF || "vessel-runner";

  const ecs = getEcsClient();
  const ec2 = getEc2Client();

  // Subnets: use configured or auto-discover from default VPC
  let subnets = (process.env.ECS_SUBNETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (subnets.length === 0) {
    subnets = await autoDiscoverSubnets(ec2);
  }

  // Security Groups: use configured or auto-discover default SG
  let securityGroups = (process.env.ECS_SECURITY_GROUPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (securityGroups.length === 0) {
    securityGroups = await autoDiscoverSecurityGroup(ec2);
  }

  // Check if task is already running
  const cached = ecsTasks.get(replId);
  if (cached) {
    try {
      const desc = await ecs.describeTasks({ cluster, tasks: [cached.taskArn] }).promise();
      const status = desc.tasks?.[0]?.lastStatus;
      if (status === "RUNNING") {
        return {
          replId,
          containerId: cached.taskArn,
          status: "RUNNING",
          appPort: cached.appPort,
          runnerPort: cached.runnerPort,
          containerIp: cached.taskIp,
        };
      }
    } catch {}
  }

  console.log(`[ECS] Starting Fargate task for ${replId} in cluster ${cluster}...`);

  const runParams = {
    cluster,
    taskDefinition: taskDef,
    launchType: process.env.ECS_LAUNCH_TYPE || "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets,
        securityGroups: securityGroups.length > 0 ? securityGroups : undefined,
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "vessel-runner",
          environment: [
            { name: "REPL_ID", value: replId },
            { name: "LANGUAGE", value: language },
            { name: "S3_BUCKET", value: process.env.S3_BUCKET || "vessel-storage" },
            { name: "AWS_REGION", value: process.env.AWS_REGION || "us-east-1" },
            { name: "AWS_ACCESS_KEY_ID", value: process.env.AWS_ACCESS_KEY_ID || "" },
            { name: "AWS_SECRET_ACCESS_KEY", value: process.env.AWS_SECRET_ACCESS_KEY || "" },
            { name: "PORT", value: "3001" },
          ],
        },
      ],
    },
  };

  const runRes = await ecs.runTask(runParams).promise();
  const task = runRes.tasks?.[0];
  if (!task || !task.taskArn) {
    const failureReason = runRes.failures?.[0]?.reason || "Unknown ECS runTask failure";
    throw new Error(`Failed to launch ECS task: ${failureReason}`);
  }

  const taskArn = task.taskArn;
  const taskIp = await resolveTaskIp(ecs, ec2, cluster, taskArn);

  const taskRecord = {
    taskArn,
    taskIp,
    appPort: 3000,
    runnerPort: 3001,
  };

  ecsTasks.set(replId, taskRecord);
  persistEcsSandbox(replId, taskRecord);

  return {
    replId,
    containerId: taskArn,
    status: "RUNNING",
    appPort: 3000,
    runnerPort: 3001,
    containerIp: taskIp,
  };
}

async function stopEcsSandbox(replId) {
  const cluster = process.env.ECS_CLUSTER || "vessel-cluster";
  const ecs = getEcsClient();

  let taskArn = ecsTasks.get(replId)?.taskArn;
  if (!taskArn) {
    try {
      const file = getActiveSandboxesFilePath();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        taskArn = data[replId]?.taskArn;
      }
    } catch {}
  }

  if (taskArn) {
    try {
      await ecs.stopTask({ cluster, task: taskArn, reason: "User stopped project sandbox" }).promise();
    } catch (err) {
      console.warn(`[ECS] Error stopping task ${taskArn}:`, err.message);
    }
  }

  ecsTasks.delete(replId);
  removePersistedEcsSandbox(replId);
  return true;
}

async function getEcsSandboxStatus(replId) {
  const cluster = process.env.ECS_CLUSTER || "vessel-cluster";
  const ecs = getEcsClient();

  const cached = ecsTasks.get(replId);
  if (!cached) {
    return { replId, status: "STOPPED" };
  }

  try {
    const desc = await ecs.describeTasks({ cluster, tasks: [cached.taskArn] }).promise();
    const task = desc.tasks?.[0];
    const status = task?.lastStatus;

    if (status === "RUNNING") {
      return {
        replId,
        containerId: cached.taskArn,
        status: "RUNNING",
        appPort: cached.appPort,
        runnerPort: cached.runnerPort,
        containerIp: cached.taskIp,
      };
    } else if (status === "PENDING" || status === "PROVISIONING") {
      return {
        replId,
        containerId: cached.taskArn,
        status: "STARTING",
      };
    }
  } catch {}

  return { replId, status: "STOPPED" };
}

function getEcsSandboxPorts(replId) {
  const cached = ecsTasks.get(replId);
  if (cached) {
    return {
      appPort: cached.appPort,
      runnerPort: cached.runnerPort,
      containerIp: cached.taskIp,
    };
  }

  try {
    const file = getActiveSandboxesFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data[replId]) {
        return {
          appPort: data[replId].appPort || 3000,
          runnerPort: data[replId].runnerPort || 3001,
          containerIp: data[replId].containerIp || data[replId].taskIp,
        };
      }
    }
  } catch {}

  return undefined;
}

module.exports = {
  isEcsConfigured,
  createEcsSandbox,
  stopEcsSandbox,
  getEcsSandboxStatus,
  getEcsSandboxPorts,
};
