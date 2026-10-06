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

function getIamClient() {
  return new AWS.IAM({
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
}

let serviceLinkedRoleVerified = false;

async function ensureServiceLinkedRole(iam) {
  if (serviceLinkedRoleVerified) return;
  try {
    await iam.createServiceLinkedRole({ AWSServiceName: "ecs.amazonaws.com" }).promise();
    console.log("[ECS] Successfully created ECS Service-Linked Role (AWSServiceRoleForECS)");
  } catch (err) {
    if (
      err.code === "InvalidInput" ||
      err.name === "InvalidInputException" ||
      (err.message && (err.message.includes("already exists") || err.message.includes("Duplicate")))
    ) {
      // Role already exists
    } else {
      console.warn("[ECS] Notice checking ECS service-linked role:", err.message);
    }
  }
  serviceLinkedRoleVerified = true;
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

let cachedSecurityGroupId = null;

/**
 * Automatically configures inbound port rules (3000-3050) on a Security Group
 */
async function authorizePorts(ec2, sgId) {
  try {
    await ec2.authorizeSecurityGroupIngress({
      GroupId: sgId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 3000,
          ToPort: 3050,
          IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "Vessel IDE runner web preview and terminal ports" }],
        },
      ],
    }).promise();
    console.log(`[ECS] Auto-configured inbound TCP ports 3000-3050 on Security Group: ${sgId}`);
  } catch (err) {
    if (err.code === "InvalidPermission.Duplicate") {
      console.log(`[ECS] Ports 3000-3050 already open on Security Group: ${sgId}`);
    } else {
      console.warn(`[ECS] Warning authorizing inbound ports on ${sgId}:`, err.message);
    }
  }
}

/**
 * Automatically gets or creates a dedicated 'vessel-runner-sg' and opens ports 3000-3050
 */
async function getOrConfigureSecurityGroup(ec2) {
  if (cachedSecurityGroupId) return [cachedSecurityGroupId];

  const userSpecified = (process.env.ECS_SECURITY_GROUPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (userSpecified.length > 0) {
    for (const sgId of userSpecified) {
      await authorizePorts(ec2, sgId);
    }
    cachedSecurityGroupId = userSpecified[0];
    return userSpecified;
  }

  // 1. Check if a dedicated 'vessel-runner-sg' security group already exists
  try {
    const existing = await ec2.describeSecurityGroups({
      Filters: [{ Name: "group-name", Values: ["vessel-runner-sg"] }],
    }).promise();
    if (existing.SecurityGroups && existing.SecurityGroups.length > 0) {
      const sgId = existing.SecurityGroups[0].GroupId;
      console.log(`[ECS] Auto-detected existing vessel-runner-sg (${sgId}). Checking port rules...`);
      await authorizePorts(ec2, sgId);
      cachedSecurityGroupId = sgId;
      return [sgId];
    }
  } catch (err) {
    console.warn("[ECS] Error checking existing vessel-runner-sg:", err.message);
  }

  // 2. Discover default VPC ID to create vessel-runner-sg inside
  let vpcId = null;
  try {
    const vpcRes = await ec2.describeVpcs({
      Filters: [{ Name: "is-default", Values: ["true"] }],
    }).promise();
    if (vpcRes.Vpcs && vpcRes.Vpcs.length > 0) {
      vpcId = vpcRes.Vpcs[0].VpcId;
    }
  } catch (err) {
    console.warn("[ECS] Error discovering default VPC for security group:", err.message);
  }

  // 3. Automatically create 'vessel-runner-sg' with port 3000-3050 permissions
  try {
    const createParams = {
      GroupName: "vessel-runner-sg",
      Description: "Automatic Vessel security group for app preview (3000) and terminal daemon (3001)",
      ...(vpcId ? { VpcId: vpcId } : {}),
    };
    const createRes = await ec2.createSecurityGroup(createParams).promise();
    const newSgId = createRes.GroupId;
    console.log(`[ECS] Automatically created dedicated Security Group ${newSgId} (vessel-runner-sg)`);
    await authorizePorts(ec2, newSgId);
    cachedSecurityGroupId = newSgId;
    return [newSgId];
  } catch (err) {
    console.warn(`[ECS] Note: Could not create new SG (${err.message}). Checking default SG...`);
  }

  // 4. Fallback: discover default SG and authorize port rules on it
  try {
    const defaultSgRes = await ec2.describeSecurityGroups({
      Filters: [{ Name: "group-name", Values: ["default"] }],
    }).promise();
    if (defaultSgRes.SecurityGroups && defaultSgRes.SecurityGroups.length > 0) {
      const defaultSg = defaultSgRes.SecurityGroups[0];
      console.log(`[ECS] Auto-configuring ports on default security group (${defaultSg.GroupId})...`);
      await authorizePorts(ec2, defaultSg.GroupId);
      cachedSecurityGroupId = defaultSg.GroupId;
      return [defaultSg.GroupId];
    }
  } catch (err) {
    console.warn("[ECS] Fallback default security group warning:", err.message);
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
      const publicIp = iface?.Association?.PublicIp;
      if (publicIp) {
        console.log(`[ECS] Task ${taskArn} resolved Public IP: ${publicIp}`);
        return publicIp;
      }
      // Wait for Public IP association unless near timeout
      if (attempt < maxAttempts - 2) {
        console.log(`[ECS] Task ENI attached (${iface?.PrivateIpAddress}), waiting for Public IP assignment (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (iface?.PrivateIpAddress) {
        return iface.PrivateIpAddress;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for ECS task network interface attachment.");
}

let clusterAndTaskDefVerified = false;

/**
 * Automatically ensures ECS cluster exists and registers task definition if missing
 */
async function ensureTaskDefinitionAndCluster(ecs, cluster, taskDef) {
  if (clusterAndTaskDefVerified) return;

  // 1. Ensure ECS Cluster exists
  try {
    const clusterRes = await ecs.describeClusters({ clusters: [cluster] }).promise();
    const existingCluster = clusterRes.clusters?.find(
      (c) => c.clusterName === cluster && c.status === "ACTIVE"
    );
    if (!existingCluster) {
      console.log(`[ECS] Cluster '${cluster}' not found or inactive. Automatically creating...`);
      await ecs.createCluster({ clusterName: cluster }).promise();
      console.log(`[ECS] Successfully created ECS cluster '${cluster}'.`);
    } else {
      console.log(`[ECS] Verified active ECS cluster '${cluster}'.`);
    }
  } catch (err) {
    console.warn(`[ECS] Cluster verification notice: ${err.message}. Ensuring cluster...`);
    try {
      await ecs.createCluster({ clusterName: cluster }).promise();
    } catch {}
  }

  // 2. Ensure Task Definition exists
  try {
    await ecs.describeTaskDefinition({ taskDefinition: taskDef }).promise();
    console.log(`[ECS] Verified Task Definition '${taskDef}'.`);
  } catch (err) {
    console.log(`[ECS] Task Definition '${taskDef}' not found. Automatically registering now...`);
    try {
      const runnerImage = process.env.RUNNER_IMAGE || "rikkyj/runner:latest";
      const regParams = {
        family: taskDef,
        networkMode: "awsvpc",
        requiresCompatibilities: ["FARGATE"],
        cpu: "1024",
        memory: "2048",
        containerDefinitions: [
          {
            name: "vessel-runner",
            image: runnerImage,
            essential: true,
            portMappings: [
              { name: "app-port", containerPort: 3000, hostPort: 3000, protocol: "tcp" },
              { name: "runner-port", containerPort: 3001, hostPort: 3001, protocol: "tcp" },
            ],
            environment: [
              { name: "PORT", value: "3001" },
              { name: "NODE_ENV", value: "production" },
            ],
          },
        ],
      };
      const regRes = await ecs.registerTaskDefinition(regParams).promise();
      console.log(`[ECS] Successfully auto-registered Task Definition '${taskDef}' (revision: ${regRes.taskDefinition?.revision})`);
    } catch (regErr) {
      console.error(`[ECS] Failed to auto-register task definition '${taskDef}':`, regErr.message);
      throw new Error(`Task definition '${taskDef}' not found and auto-registration failed: ${regErr.message}`);
    }
  }

  clusterAndTaskDefVerified = true;
}

/**
 * Launches an isolated ECS Fargate sandbox task
 */
async function createEcsSandbox({ replId, language = "node-js" }) {
  const cluster = process.env.ECS_CLUSTER || "vessel-cluster";
  const taskDef = process.env.ECS_TASK_DEFINITION || process.env.ECS_TASK_DEF || "vessel-runner";

  const ecs = getEcsClient();
  const ec2 = getEc2Client();
  const iam = getIamClient();

  // 0. Ensure ECS Service Linked Role (AWSServiceRoleForECS) exists in AWS account
  await ensureServiceLinkedRole(iam);

  // Subnets: use configured or auto-discover from default VPC
  let subnets = (process.env.ECS_SUBNETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (subnets.length === 0) {
    subnets = await autoDiscoverSubnets(ec2);
  }

  // Security Groups: automatically discover or create dedicated SG with open ports 3000-3050
  let securityGroups = await getOrConfigureSecurityGroup(ec2);

  // Automatically ensure cluster and task definition exist in AWS account
  await ensureTaskDefinitionAndCluster(ecs, cluster, taskDef);

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
