import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { Logger } from "pino";

import type { DedicatedClient } from "../transport/dedicated-client.js";
import { SmxClient, type SmxMapSummary } from "../integrations/mania-exchange/smx-client.js";

export interface MapImportServiceOptions {
  mapsDirectory: string;
  targetRelativeDirectory: string;
  insertMode?: "add" | "insert";
}

export interface ImportedMapResult {
  map: SmxMapSummary;
  absolutePath: string;
  serverFileName: string;
  insertedWith: "add" | "insert";
  alreadyPresent: boolean;
}

export class MapImportService {
  private readonly client: DedicatedClient;
  private readonly smxClient: SmxClient;
  private readonly logger: Logger;

  public constructor(client: DedicatedClient, logger: Logger, smxClient = new SmxClient()) {
    this.client = client;
    this.logger = logger.child({ component: "map-import" });
    this.smxClient = smxClient;
  }

  public async searchMaps(name: string, limit = 10): Promise<SmxMapSummary[]> {
    return this.smxClient.searchMaps({ name, limit });
  }

  public async importMapById(
    mapId: number,
    options: MapImportServiceOptions
  ): Promise<ImportedMapResult> {
    const summary = await this.fetchMapSummaryById(mapId);

    const mapsDirectory = resolve(options.mapsDirectory);
    const targetRelativeDirectory = normalizeServerDirectory(options.targetRelativeDirectory);
    const insertMode = options.insertMode ?? "add";
    const fileName = `${createSafeFileStem(summary)}.Map.Gbx`;
    const absolutePath = join(mapsDirectory, fileName);
    const serverFileName = joinServerPath(targetRelativeDirectory, fileName);

    await mkdir(mapsDirectory, { recursive: true });

    const alreadyPresent = await pathExists(absolutePath);
    if (!alreadyPresent) {
      const mapBuffer = await this.smxClient.downloadMap(mapId);
      await writeFile(absolutePath, mapBuffer);
      this.logger.info({ mapId, absolutePath }, "Downloaded SMX map");
    } else {
      this.logger.info({ mapId, absolutePath }, "SMX map already present locally");
    }

    if (insertMode === "insert") {
      await this.client.insertMap(serverFileName);
    } else {
      await this.client.addMap(serverFileName);
    }

    return {
      map: summary,
      absolutePath,
      serverFileName,
      insertedWith: insertMode,
      alreadyPresent
    };
  }

  private async fetchMapSummaryById(mapId: number): Promise<SmxMapSummary> {
    const match = await this.smxClient.getMapById(mapId);
    if (match) {
      return match;
    }

    return {
      mapId,
      authorNames: [],
      downloadUrl: `https://sm.mania.exchange/maps/download/${mapId}`
    };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeServerDirectory(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/u, "");
}

function joinServerPath(...parts: string[]): string {
  return parts
    .map((part) => part.replaceAll("/", "\\").replace(/^\\+|\\+$/gu, ""))
    .filter((part) => part.length > 0)
    .join("\\");
}

function createSafeFileStem(map: SmxMapSummary): string {
  const rawName = map.gbxMapName ?? map.name ?? `smx-${map.mapId}`;
  const author = map.author ?? "unknown";
  const safeName = sanitizeSegment(rawName);
  const safeAuthor = sanitizeSegment(author);
  return basename(`${safeName}__${safeAuthor}__${map.mapId}`, ".Map.Gbx");
}

function sanitizeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/gu, "")
    .trim()
    .replace(/\s+/gu, "_")
    .replace(/_+/gu, "_")
    .slice(0, 80) || "map";
}
