import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDeployInstance, getDeployInstanceStatus, listDeployInstances } from "./instance-manager.js";

describe("instance-manager", () => {
  it("creates and lists deploy instances", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mcts-deploy-"));

    const result = await createDeployInstance({
      id: "Elite Main",
      label: "Elite Main",
      rootDir,
      serverHost: "127.0.0.1",
      serverPort: 5000,
      serverPassword: "secret",
      adminHost: "127.0.0.1",
      adminPort: 3001,
      serverFilesRoot: "./server"
    });

    expect(result.instance.id).toBe("elite-main");
    expect(result.instance.configPath).toBe(join(rootDir, "elite-main", "maniacontrol.local.json"));
    expect(result.ownerToken).toMatch(/^mcts_owner_/);
    expect(result.observerToken).toMatch(/^mcts_observer_/);
    expect(result.instance.launcherPath).toBe(join(rootDir, "elite-main", "run-instance.sh"));
    expect(result.instance.systemdUnitPath).toBe(join(rootDir, "systemd", "maniacontrol-ts-elite-main.service"));

    const listed = await listDeployInstances(rootDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("elite-main");

    const configRaw = await readFile(join(rootDir, "elite-main", "maniacontrol.local.json"), "utf8");
    const config = JSON.parse(configRaw) as Record<string, any>;
    expect(config.admin.serverFilesRoot).toBe("./server");
    expect(config.storage.url).toBe(join(rootDir, "elite-main", "data", "maniacontrol.sqlite"));
    expect(config.admin.principals).toHaveLength(2);

    const launcherRaw = await readFile(join(rootDir, "elite-main", "run-instance.sh"), "utf8");
    expect(launcherRaw).toContain("node dist/index.js --config");

    const unitRaw = await readFile(join(rootDir, "systemd", "maniacontrol-ts-elite-main.service"), "utf8");
    expect(unitRaw).toContain("ExecStart=");

    const status = await getDeployInstanceStatus(rootDir, "elite-main");
    expect(Array.isArray(status)).toBe(false);
    if (Array.isArray(status)) {
      throw new Error("Expected a single instance status");
    }
    expect(status.files.configExists).toBe(true);
    expect(status.files.launcherExists).toBe(true);
    expect(status.files.systemdUnitExists).toBe(true);
  });
});
