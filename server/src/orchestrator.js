const { isEcsConfigured, createEcsSandbox, stopEcsSandbox, getEcsSandboxStatus, getEcsSandboxPorts, getEcsSandboxPortsAsync } = require("./ecs");
const { createDockerSandbox, stopDockerSandbox, getDockerSandboxStatus, getDockerSandboxPorts } = require("./docker");

function shouldUseEcs() {
  return isEcsConfigured();
}

async function startSandbox(params) {
  if (shouldUseEcs()) {
    return createEcsSandbox(params);
  }
  return createDockerSandbox(params);
}

async function stopSandbox(replId) {
  if (shouldUseEcs()) {
    return stopEcsSandbox(replId);
  }
  return stopDockerSandbox(replId);
}

async function getSandboxStatus(replId) {
  if (shouldUseEcs()) {
    return getEcsSandboxStatus(replId);
  }
  return getDockerSandboxStatus(replId);
}

function getSandboxPorts(replId) {
  if (shouldUseEcs()) {
    const ecsPorts = getEcsSandboxPorts(replId);
    if (ecsPorts) return ecsPorts;
  }
  return getDockerSandboxPorts(replId);
}

async function getSandboxPortsAsync(replId) {
  if (shouldUseEcs()) {
    const ecsPorts = await getEcsSandboxPortsAsync(replId);
    if (ecsPorts) return ecsPorts;
  }
  return getDockerSandboxPorts(replId);
}

module.exports = {
  shouldUseEcs,
  startSandbox,
  stopSandbox,
  getSandboxStatus,
  getSandboxPorts,
  getSandboxPortsAsync,
};
