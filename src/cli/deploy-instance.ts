import { argv } from "node:process";

import { createDeployInstance, listDeployInstances } from "../deploy/instance-manager.js";

async function main(): Promise<void> {
  const command = argv[2];

  if (command === "list") {
    const instances = await listDeployInstances(getFlag("--root") ?? "./deployments");
    console.log(JSON.stringify({ count: instances.length, instances }, null, 2));
    return;
  }

  if (command === "create") {
    const id = argv[3];
    if (!id) {
      throw new Error("Usage: tsx src/cli/deploy-instance.ts create <id> [--root ./deployments] ...");
    }

    const result = await createDeployInstance({
      id,
      label: getFlag("--label"),
      rootDir: getFlag("--root") ?? "./deployments",
      serverHost: getFlag("--server-host") ?? "127.0.0.1",
      serverPort: getIntFlag("--server-port", 5000),
      serverUser: getServerUserFlag(),
      serverPassword: getFlag("--server-password") ?? "change-me",
      adminHost: getFlag("--admin-host") ?? "127.0.0.1",
      adminPort: getIntFlag("--admin-port", 3001),
      serverFilesRoot: getFlag("--server-files-root") ?? "./server"
    });

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(
    "Usage: tsx src/cli/deploy-instance.ts <list|create> [args]\n"
    + "  create <id> [--root ./deployments] [--server-host 127.0.0.1] [--server-port 5000]\n"
    + "              [--server-user SuperAdmin] [--server-password change-me]\n"
    + "              [--admin-host 127.0.0.1] [--admin-port 3001] [--server-files-root ./server]"
  );
}

function getFlag(flag: string): string | undefined {
  const index = argv.findIndex((argument) => argument === flag);
  return index === -1 ? undefined : argv[index + 1];
}

function getIntFlag(flag: string, fallback: number): number {
  const value = getFlag(flag);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function getServerUserFlag(): "User" | "Admin" | "SuperAdmin" | undefined {
  const value = getFlag("--server-user");
  if (!value) return undefined;
  if (value !== "User" && value !== "Admin" && value !== "SuperAdmin") {
    throw new Error("--server-user must be one of: User, Admin, SuperAdmin");
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
