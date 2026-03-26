import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

interface DeployManifest {
  version: 1;
  instances: DeployInstanceRecord[];
}

export interface DeployInstanceRecord {
  id: string;
  label: string;
  configPath: string;
  dataDir: string;
  workDir: string;
  launcherPath: string;
  systemdUnitPath: string;
  systemdUnitName: string;
  serverHost: string;
  serverPort: number;
  adminHost: string;
  adminPort: number;
  serverFilesRoot: string;
  createdAt: string;
}

export interface CreateDeployInstanceOptions {
  id: string;
  label?: string;
  rootDir: string;
  serverHost: string;
  serverPort: number;
  serverUser?: "User" | "Admin" | "SuperAdmin";
  serverPassword: string;
  adminHost: string;
  adminPort: number;
  serverFilesRoot: string;
}

export interface CreateDeployInstanceResult {
  instance: DeployInstanceRecord;
  configPath: string;
  manifestPath: string;
  ownerToken: string;
  observerToken: string;
}

export interface DeployInstanceStatus {
  instance: DeployInstanceRecord;
  files: {
    configExists: boolean;
    dataDirExists: boolean;
    launcherExists: boolean;
    systemdUnitExists: boolean;
  };
  systemd: {
    available: boolean;
    active?: string;
    enabled?: string;
  };
}

const DEFAULT_MANIFEST: DeployManifest = {
  version: 1,
  instances: []
};

export async function listDeployInstances(rootDir: string): Promise<DeployInstanceRecord[]> {
  const manifest = await readManifest(rootDir);
  return manifest.instances.slice().sort((left, right) => left.id.localeCompare(right.id));
}

export async function getDeployInstance(rootDir: string, id: string): Promise<DeployInstanceRecord> {
  const instanceId = normalizeInstanceId(id);
  const instances = await listDeployInstances(rootDir);
  const instance = instances.find((entry) => entry.id === instanceId);
  if (!instance) {
    throw new Error(`Unknown instance "${instanceId}".`);
  }
  return instance;
}

export async function getDeployInstanceStatus(rootDir: string, id?: string): Promise<DeployInstanceStatus | DeployInstanceStatus[]> {
  if (id) {
    return buildStatus(await getDeployInstance(rootDir, id));
  }
  const instances = await listDeployInstances(rootDir);
  return Promise.all(instances.map((instance) => buildStatus(instance)));
}

export async function createDeployInstance(options: CreateDeployInstanceOptions): Promise<CreateDeployInstanceResult> {
  const rootDir = resolve(options.rootDir);
  const repoRoot = resolve(".");
  const instanceId = normalizeInstanceId(options.id);
  const instanceLabel = options.label?.trim() || instanceId;
  const manifest = await readManifest(rootDir);

  if (manifest.instances.some((instance) => instance.id === instanceId)) {
    throw new Error(`Instance "${instanceId}" already exists.`);
  }

  assertPortAvailable(manifest.instances, options.serverPort, "serverPort");
  assertPortAvailable(manifest.instances, options.adminPort, "adminPort");

  const instanceDir = resolve(rootDir, instanceId);
  const dataDir = resolve(instanceDir, "data");
  const configPath = resolve(instanceDir, "maniacontrol.local.json");
  const launcherPath = resolve(instanceDir, "run-instance.sh");
  const systemdUnitName = `maniacontrol-ts-${instanceId}.service`;
  const systemdUnitPath = resolve(rootDir, "systemd", systemdUnitName);
  const createdAt = new Date().toISOString();
  const ownerToken = createToken("mcts_owner");
  const observerToken = createToken("mcts_observer");

  const config = {
    server: {
      host: options.serverHost,
      port: options.serverPort,
      user: options.serverUser ?? "SuperAdmin",
      password: options.serverPassword
    },
    controller: {
      apiVersion: "2013-04-16",
      scriptApiVersion: "2.5.0",
      enableCallbacks: true,
      pollIntervalMs: 100,
      logLevel: "info"
    },
    admin: {
      enabled: true,
      host: options.adminHost,
      port: options.adminPort,
      serverFilesRoot: options.serverFilesRoot,
      principals: [
        {
          id: `${instanceId}-owner`,
          label: `${instanceLabel} Owner`,
          role: "owner",
          token: ownerToken,
          scopes: [
            "read",
            "audit.read",
            "players.write",
            "players.sanctions.read",
            "players.sanctions.write",
            "maps.write",
            "elite.write",
            "chat.write",
            "votes.write",
            "mode.write",
            "mx.write"
          ]
        },
        {
          id: `${instanceId}-observer`,
          label: `${instanceLabel} Observer`,
          role: "observer",
          token: observerToken,
          scopes: [
            "read",
            "audit.read"
          ]
        }
      ],
      modePresets: [],
      auditPath: toRootRelativePath(resolve(dataDir, "admin-audit.jsonl")),
      activityPath: toRootRelativePath(resolve(dataDir, "admin-activity.jsonl")),
      localRecordsPath: toRootRelativePath(resolve(dataDir, "local-records.json")),
      chatLoggingEnabled: false
    },
    storage: {
      driver: "sqlite",
      url: toRootRelativePath(resolve(dataDir, "maniacontrol.sqlite"))
    },
    plugins: [
      {
        id: "server-info",
        enabled: true
      },
      {
        id: "shootmania-elite",
        enabled: true,
        settings: {
          historyLimit: 20,
          logTurns: true,
          logStateSnapshots: false,
          autoPauseEnabled: false,
          showWidget: true
        }
      },
      {
        id: "maniaexchange",
        enabled: false,
        settings: {
          mapsDirectory: toRootRelativePath(resolve(options.serverFilesRoot, "UserData", "Maps", "My Maps", "SMX")),
          targetRelativeDirectory: "My Maps\\SMX",
          importOnStartIds: [],
          insertMode: "add",
          announceImports: true,
          showWidget: true,
          searchLimit: 6,
          defaultQuery: "elite"
        }
      }
    ]
  };

  await mkdir(dataDir, { recursive: true });
  await writeJson(configPath, config);
  await writeLauncherScript(launcherPath, repoRoot, configPath);
  await writeSystemdUnit(systemdUnitPath, {
    label: instanceLabel,
    repoRoot,
    launcherPath
  });

  const instance: DeployInstanceRecord = {
    id: instanceId,
    label: instanceLabel,
    configPath: toRootRelativePath(configPath),
    dataDir: toRootRelativePath(dataDir),
    workDir: toRootRelativePath(repoRoot),
    launcherPath: toRootRelativePath(launcherPath),
    systemdUnitPath: toRootRelativePath(systemdUnitPath),
    systemdUnitName,
    serverHost: options.serverHost,
    serverPort: options.serverPort,
    adminHost: options.adminHost,
    adminPort: options.adminPort,
    serverFilesRoot: options.serverFilesRoot,
    createdAt
  };

  const nextManifest: DeployManifest = {
    version: 1,
    instances: [...manifest.instances, instance]
  };
  await writeJson(getManifestPath(rootDir), nextManifest);

  return {
    instance,
    configPath: instance.configPath,
    manifestPath: toRootRelativePath(getManifestPath(rootDir)),
    ownerToken,
    observerToken
  };
}

async function readManifest(rootDir: string): Promise<DeployManifest> {
  const manifestPath = getManifestPath(rootDir);
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as DeployManifest;
    return {
      version: 1,
      instances: Array.isArray(parsed.instances) ? parsed.instances : []
    };
  } catch {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeJson(manifestPath, DEFAULT_MANIFEST);
    return DEFAULT_MANIFEST;
  }
}

async function buildStatus(instance: DeployInstanceRecord): Promise<DeployInstanceStatus> {
  const [configExists, dataDirExists, launcherExists, systemdUnitExists] = await Promise.all([
    pathExists(instance.configPath),
    pathExists(instance.dataDir),
    pathExists(instance.launcherPath),
    pathExists(instance.systemdUnitPath)
  ]);

  return {
    instance,
    files: {
      configExists,
      dataDirExists,
      launcherExists,
      systemdUnitExists
    },
    systemd: getSystemdStatus(instance.systemdUnitName)
  };
}

function getManifestPath(rootDir: string): string {
  return resolve(rootDir, "instances.json");
}

function normalizeInstanceId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Instance id must contain at least one alphanumeric character.");
  }
  return normalized;
}

function assertPortAvailable(instances: DeployInstanceRecord[], port: number, field: "serverPort" | "adminPort"): void {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  const existing = instances.find((instance) => instance[field] === port);
  if (existing) {
    throw new Error(`Port ${port} is already used by instance "${existing.id}" (${field}).`);
  }
}

function createToken(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeLauncherScript(path: string, repoRoot: string, configPath: string): Promise<void> {
  const content = `#!/usr/bin/env bash
set -euo pipefail
cd "${escapeShell(repoRoot)}"
exec node dist/index.js --config "${escapeShell(configPath)}"
`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function writeSystemdUnit(
  path: string,
  options: { label: string; repoRoot: string; launcherPath: string; }
): Promise<void> {
  const content = `[Unit]
Description=ManiaControl TS (${options.label})
After=network.target

[Service]
Type=simple
WorkingDirectory=${options.repoRoot}
ExecStart=${options.launcherPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getSystemdStatus(unitName: string): DeployInstanceStatus["systemd"] {
  const probe = spawnSync("systemctl", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    return { available: false };
  }

  const active = spawnSync("systemctl", ["is-active", unitName], { encoding: "utf8" });
  const enabled = spawnSync("systemctl", ["is-enabled", unitName], { encoding: "utf8" });

  return {
    available: true,
    active: normalizeSystemctlOutput(active.stdout || active.stderr),
    enabled: normalizeSystemctlOutput(enabled.stdout || enabled.stderr)
  };
}

function normalizeSystemctlOutput(value: string): string {
  const normalized = value.trim();
  return normalized || "unknown";
}

function escapeShell(value: string): string {
  return value.replace(/"/g, '\\"');
}

function toRootRelativePath(path: string): string {
  const repoRoot = resolve(".");
  const normalized = resolve(path);
  if (normalized.startsWith(`${repoRoot}/`)) {
    return `.${normalized.slice(repoRoot.length)}`;
  }
  return normalized;
}
