import { NextResponse } from "next/server";
import { getDockerClient, checkDockerAvailability } from "@/lib/docker";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  const sockPath = "/var/run/docker.sock";
  const sockExists = fs.existsSync(sockPath);
  let sockStats: any = null;
  if (sockExists) {
    try {
      const stats = fs.statSync(sockPath);
      sockStats = {
        mode: (stats.mode & parseInt("777", 8)).toString(8),
        uid: stats.uid,
        gid: stats.gid,
      };
    } catch (e: any) {
      sockStats = { error: e.message };
    }
  }

  let pingSuccess = false;
  let pingError: string | null = null;
  let containers: any[] = [];

  try {
    const docker = getDockerClient();
    await docker.ping();
    pingSuccess = true;
    const rawContainers = await docker.listContainers({ all: true });
    containers = rawContainers.map((c) => ({
      id: c.Id.substring(0, 12),
      names: c.Names,
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports,
    }));
  } catch (err: any) {
    pingError = err.message;
  }

  return NextResponse.json({
    dockerAvailable: pingSuccess,
    pingError,
    sockExists,
    sockStats,
    runnerImageEnv: process.env.RUNNER_IMAGE || "vessel-runner:latest",
    containers,
    env: {
      DOCKER_HOST: process.env.DOCKER_HOST || "",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
}
