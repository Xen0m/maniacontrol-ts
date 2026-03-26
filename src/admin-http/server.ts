import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import type { CallbackBus } from "../core/callbacks.js";
import type { DedicatedClient, DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";
import { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";
import { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { SseHub } from "./sse-hub.js";

interface ControllerSnapshot {
  startedAt: string;
  version?: DedicatedVersion;
  systemInfo?: DedicatedSystemInfo;
}

interface AdminHttpServerOptions {
  config: NonNullable<AppConfig["admin"]>;
  logger: Logger;
  callbacks: CallbackBus;
  client: DedicatedClient;
  getSnapshot: () => ControllerSnapshot;
  getElitePlugin: () => ShootManiaElitePlugin | undefined;
  getManiaExchangePlugin: () => ManiaExchangePlugin | undefined;
}

export class AdminHttpServer {
  private readonly config: NonNullable<AppConfig["admin"]>;
  private readonly logger: Logger;
  private readonly callbacks: CallbackBus;
  private readonly client: DedicatedClient;
  private readonly getSnapshot: () => ControllerSnapshot;
  private readonly getElitePlugin: () => ShootManiaElitePlugin | undefined;
  private readonly getManiaExchangePlugin: () => ManiaExchangePlugin | undefined;
  private readonly sseHub = new SseHub();
  private server?: Server;

  public constructor(options: AdminHttpServerOptions) {
    this.config = options.config;
    this.logger = options.logger.child({ component: "admin-http" });
    this.callbacks = options.callbacks;
    this.client = options.client;
    this.getSnapshot = options.getSnapshot;
    this.getElitePlugin = options.getElitePlugin;
    this.getManiaExchangePlugin = options.getManiaExchangePlugin;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    this.callbacks.on("Plugin.ShootManiaElite.StateChanged", (event) => {
      this.sseHub.publish("elite.stateChanged", event);
    });
    this.callbacks.on("ManiaPlanet.BeginMap", (event) => {
      this.sseHub.publish("server.beginMap", event);
    });
    this.callbacks.on("ManiaPlanet.EndMap", (event) => {
      this.sseHub.publish("server.endMap", event);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.config.port, this.config.host, () => resolve());
    });

    const address = this.server.address() as AddressInfo | null;
    this.logger.info(
      {
        host: address?.address ?? this.config.host,
        port: address?.port ?? this.config.port
      },
      "Admin HTTP server started"
    );
  }

  public async stop(): Promise<void> {
    this.sseHub.closeAll();
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!this.isAuthorized(request)) {
      return this.writeJson(response, 401, {
        error: "unauthorized"
      });
    }

    try {
      if (method === "GET" && url.pathname === "/health") {
        return this.writeJson(response, 200, {
          status: "ok",
          startedAt: this.getSnapshot().startedAt,
          admin: {
            realtimeClients: this.sseHub.getClientCount()
          },
          dedicated: {
            version: this.getSnapshot().version,
            systemInfo: this.getSnapshot().systemInfo
          }
        });
      }

      if (method === "GET" && url.pathname === "/server/info") {
        const status = await this.client.getStatus();
        const gameMode = await this.client.getGameMode();
        return this.writeJson(response, 200, {
          ...this.getSnapshot(),
          status,
          gameMode
        });
      }

      if (method === "GET" && url.pathname === "/server/maps/current") {
        const currentMap = await this.client.getCurrentMapInfo();
        return this.writeJson(response, 200, currentMap);
      }

      if (method === "GET" && url.pathname === "/server/maps/next") {
        const nextMap = await this.client.getNextMapInfo();
        return this.writeJson(response, 200, nextMap);
      }

      if (method === "GET" && url.pathname === "/server/maps") {
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
        const maps = await this.client.getMapList(limit, offset);
        return this.writeJson(response, 200, {
          offset,
          limit,
          count: maps.length,
          maps
        });
      }

      if (method === "POST" && url.pathname === "/server/maps/choose-next") {
        const body = await this.readJsonBody(request);
        const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
        if (!fileName) {
          return this.writeJson(response, 400, { error: "fileName is required" });
        }

        await this.client.chooseNextMap(fileName);
        const nextMap = await this.client.getNextMapInfo();
        this.sseHub.publish("server.nextMapChanged", {
          fileName,
          nextMap
        });
        return this.writeJson(response, 200, nextMap);
      }

      if (method === "GET" && url.pathname === "/elite/state") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        return this.writeJson(response, 200, elitePlugin.getStateSnapshot());
      }

      if (method === "POST" && url.pathname === "/elite/pause") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        const state = await elitePlugin.pauseMatch();
        this.sseHub.publish("elite.pause", { paused: true, state });
        return this.writeJson(response, 200, state);
      }

      if (method === "POST" && url.pathname === "/elite/resume") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        const state = await elitePlugin.resumeMatch();
        this.sseHub.publish("elite.resume", { paused: false, state });
        return this.writeJson(response, 200, state);
      }

      if (method === "GET" && url.pathname === "/mx/search") {
        const mxPlugin = this.getManiaExchangePlugin();
        if (!mxPlugin) {
          return this.writeJson(response, 503, { error: "maniaexchange plugin is not enabled" });
        }
        const query = url.searchParams.get("q") ?? "";
        const results = await mxPlugin.searchMaps(query);
        return this.writeJson(response, 200, {
          query,
          results
        });
      }

      if (method === "POST" && url.pathname === "/mx/import") {
        const mxPlugin = this.getManiaExchangePlugin();
        if (!mxPlugin) {
          return this.writeJson(response, 503, { error: "maniaexchange plugin is not enabled" });
        }

        const body = await this.readJsonBody(request);
        const mapId = typeof body.mapId === "number" ? body.mapId : Number(body.mapId);
        if (!Number.isInteger(mapId) || mapId <= 0) {
          return this.writeJson(response, 400, { error: "mapId must be a positive integer" });
        }

        const result = await mxPlugin.importMapById(mapId);
        this.sseHub.publish("mx.import", {
          mapId,
          mapName: result.map.gbxMapName ?? result.map.name,
          fileName: result.serverFileName
        });
        return this.writeJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });
        response.write("\n");
        this.sseHub.addClient(response);
        this.sseHub.publish("system.connected", {
          clientCount: this.sseHub.getClientCount()
        });
        return;
      }

      this.writeJson(response, 404, { error: "not found" });
    } catch (error) {
      this.logger.error({ error, method, path: url.pathname }, "Admin API request failed");
      this.writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (!header) {
      return false;
    }
    const [scheme, token] = header.split(/\s+/, 2);
    return scheme === "Bearer" && token === this.config.token;
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) {
      return {};
    }

    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }

  private writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(body, null, 2));
  }
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
