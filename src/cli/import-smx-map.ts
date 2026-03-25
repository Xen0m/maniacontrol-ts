import { argv } from "node:process";

import { loadConfig } from "../config/load-config.js";
import { createLogger } from "../logging/logger.js";
import { DedicatedClient } from "../transport/dedicated-client.js";
import { MapImportService } from "../maps/map-import-service.js";

async function main(): Promise<void> {
  const command = argv[2];
  if (command !== "search" && command !== "import") {
    throw new Error("Usage: node dist/cli/import-smx-map.js <search|import> ...");
  }

  const configPath = getFlag("--config") ?? "maniacontrol.local.json";
  const config = await loadConfig(configPath);
  const logger = createLogger(config.controller.logLevel);

  if (command === "search") {
    const query = argv[3];
    if (!query) {
      throw new Error("Usage: node dist/cli/import-smx-map.js search <query> [--limit N]");
    }

    const limit = Number(getFlag("--limit") ?? "10");
    const importer = new MapImportService(
      new DedicatedClient(config.server.host, config.server.port, 30_000, logger),
      logger
    );
    const results = await importer.searchMaps(query, limit);
    for (const result of results) {
      console.log(
        `${result.mapId}\t${result.gbxMapName ?? result.name ?? "unknown"}\t${result.author ?? "-"}`
      );
    }
    return;
  }

  const mapId = Number(argv[3]);
  if (!Number.isInteger(mapId) || mapId <= 0) {
    throw new Error("Usage: node dist/cli/import-smx-map.js import <mapId> --maps-dir <dir> --target-dir <serverDir>");
  }

  const mapsDirectory = getFlag("--maps-dir");
  const targetRelativeDirectory = getFlag("--target-dir");
  const insertMode = getFlag("--insert-mode") === "insert" ? "insert" : "add";

  if (!mapsDirectory || !targetRelativeDirectory) {
    throw new Error("Missing required flags: --maps-dir and --target-dir");
  }

  const client = new DedicatedClient(config.server.host, config.server.port, 30_000, logger);
  await client.connect(config.server.user, config.server.password, config.controller.apiVersion);
  const importer = new MapImportService(client, logger);

  try {
    const result = await importer.importMapById(mapId, {
      mapsDirectory,
      targetRelativeDirectory,
      insertMode
    });

    console.log(
      JSON.stringify(
        {
          mapId: result.map.mapId,
          name: result.map.gbxMapName ?? result.map.name,
          author: result.map.author,
          absolutePath: result.absolutePath,
          serverFileName: result.serverFileName,
          insertedWith: result.insertedWith,
          alreadyPresent: result.alreadyPresent
        },
        null,
        2
      )
    );
  } finally {
    client.close();
  }
}

function getFlag(flag: string): string | undefined {
  const index = argv.findIndex((argument) => argument === flag);
  return index === -1 ? undefined : argv[index + 1];
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
