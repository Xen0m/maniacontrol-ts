import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import type { CallbackBus } from "../core/callbacks.js";
import type { DedicatedClient, DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";
import type { XmlRpcValue } from "../xmlrpc/types.js";
import { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";
import { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { SseHub } from "./sse-hub.js";
import { AdminAuditLog } from "./audit-log.js";

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
  private readonly auditLog: AdminAuditLog;
  private server?: Server;

  public constructor(options: AdminHttpServerOptions) {
    this.config = options.config;
    this.logger = options.logger.child({ component: "admin-http" });
    this.callbacks = options.callbacks;
    this.client = options.client;
    this.getSnapshot = options.getSnapshot;
    this.getElitePlugin = options.getElitePlugin;
    this.getManiaExchangePlugin = options.getManiaExchangePlugin;
    this.auditLog = new AdminAuditLog(this.config.auditPath);
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      (response as ServerResponse & { req?: IncomingMessage }).req = request;
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
    this.callbacks.on("ManiaPlanet.PlayerConnect", (event) => {
      this.sseHub.publish("server.playerConnect", event);
    });
    this.callbacks.on("ManiaPlanet.PlayerDisconnect", (event) => {
      this.sseHub.publish("server.playerDisconnect", event);
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
        return await this.writeJson(response, 200, {
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
        return await this.writeJson(response, 200, {
          ...this.getSnapshot(),
          status,
          gameMode
        });
      }

      if (method === "GET" && url.pathname === "/server/mode-script-info") {
        const modeScriptInfo = await this.client.getModeScriptInfo();
        return await this.writeJson(response, 200, modeScriptInfo);
      }

      if (method === "GET" && url.pathname === "/server/mode-script-settings") {
        const settings = await this.client.getModeScriptSettings();
        return await this.writeJson(response, 200, settings);
      }

      if (method === "GET" && url.pathname === "/server/maps/current") {
        const currentMap = await this.client.getCurrentMapInfo();
        return await this.writeJson(response, 200, currentMap);
      }

      if (method === "GET" && url.pathname === "/server/maps/next") {
        const nextMap = await this.client.getNextMapInfo();
        return await this.writeJson(response, 200, nextMap);
      }

      if (method === "GET" && url.pathname === "/server/maps") {
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
        const maps = await this.client.getMapList(limit, offset);
        return await this.writeJson(response, 200, {
          offset,
          limit,
          count: maps.length,
          maps
        });
      }

      if (method === "GET" && url.pathname === "/server/players") {
        const players = await this.client.getPlayerList(100, 0, 1);
        const detailedPlayers = await Promise.all(
          players.map(async (player) => {
            if (!player.login) return player;
            try {
              return {
                ...player,
                ...(await this.client.getDetailedPlayerInfo(player.login))
              };
            } catch {
              return player;
            }
          })
        );
        return await this.writeJson(response, 200, {
          count: detailedPlayers.length,
          players: detailedPlayers
        });
      }

      if (method === "POST" && url.pathname === "/server/maps/choose-next") {
        const body = await this.readJsonBody(request);
        const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
        if (!fileName) {
          return await this.writeJson(response, 400, { error: "fileName is required" });
        }

        await this.client.chooseNextMap(fileName);
        const nextMap = await this.client.getNextMapInfo();
        this.sseHub.publish("server.nextMapChanged", {
          fileName,
          nextMap
        });
        return await this.writeJson(response, 200, nextMap, {
          action: "server.maps.choose-next",
          success: true,
          detail: { fileName }
        });
      }

      if (method === "POST" && url.pathname === "/server/mode-script-settings") {
        const body = await this.readJsonBody(request);
        const settings = isXmlRpcStruct(body.settings) ? body.settings : isXmlRpcStruct(body) ? body : null;
        if (!settings) {
          return await this.writeJson(response, 400, { error: "settings object is required" });
        }

        await this.client.setModeScriptSettings(settings);
        const nextSettings = await this.client.getModeScriptSettings();
        this.sseHub.publish("server.modeScriptSettingsChanged", {
          settings: nextSettings
        });
        return await this.writeJson(response, 200, nextSettings, {
          action: "server.mode-script-settings.update",
          success: true
        });
      }

      if (method === "POST" && url.pathname === "/server/mode-script-commands") {
        const body = await this.readJsonBody(request);
        const commands = isXmlRpcStruct(body.commands) ? body.commands : isXmlRpcStruct(body) ? body : null;
        if (!commands) {
          return await this.writeJson(response, 400, { error: "commands object is required" });
        }

        await this.client.sendModeScriptCommands(commands);
        this.sseHub.publish("server.modeScriptCommandsSent", {
          commands
        });
        return await this.writeJson(response, 200, { ok: true, commands }, {
          action: "server.mode-script-commands.send",
          success: true
        });
      }

      if (method === "POST" && url.pathname === "/server/maps/jump") {
        const body = await this.readJsonBody(request);
        const uId = typeof body.uId === "string" ? body.uId.trim() : "";
        if (!uId) {
          return await this.writeJson(response, 400, { error: "uId is required" });
        }

        await this.client.jumpToMapIdent(uId);
        const currentMap = await this.client.getCurrentMapInfo();
        this.sseHub.publish("server.mapJumped", {
          uId,
          currentMap
        });
        return await this.writeJson(response, 200, currentMap, {
          action: "server.maps.jump",
          success: true,
          detail: { uId }
        });
      }

      if (method === "POST" && url.pathname === "/server/players/kick") {
        const body = await this.readJsonBody(request);
        const login = typeof body.login === "string" ? body.login.trim() : "";
        const message = typeof body.message === "string" ? body.message : "";
        if (!login) {
          return await this.writeJson(response, 400, { error: "login is required" });
        }

        await this.client.kick(login, message);
        this.sseHub.publish("server.playerKicked", { login, message });
        return await this.writeJson(response, 200, { ok: true, login }, {
          action: "server.players.kick",
          success: true,
          detail: { login }
        });
      }

      if (method === "POST" && url.pathname === "/server/players/force-team") {
        const body = await this.readJsonBody(request);
        const login = typeof body.login === "string" ? body.login.trim() : "";
        const team = typeof body.team === "number" ? body.team : Number(body.team);
        if (!login || ![0, 1].includes(team)) {
          return await this.writeJson(response, 400, { error: "login and team(0|1) are required" });
        }

        await this.client.forcePlayerTeam(login, team as 0 | 1);
        this.sseHub.publish("server.playerTeamForced", { login, team });
        return await this.writeJson(response, 200, { ok: true, login, team }, {
          action: "server.players.force-team",
          success: true,
          detail: { login, team }
        });
      }

      if (method === "POST" && url.pathname === "/server/players/force-spectator") {
        const body = await this.readJsonBody(request);
        const login = typeof body.login === "string" ? body.login.trim() : "";
        const mode = typeof body.mode === "number" ? body.mode : Number(body.mode);
        if (!login || ![0, 1, 2, 3].includes(mode)) {
          return await this.writeJson(response, 400, { error: "login and mode(0..3) are required" });
        }

        await this.client.forceSpectator(login, mode as 0 | 1 | 2 | 3);
        this.sseHub.publish("server.playerSpectatorForced", { login, mode });
        return await this.writeJson(response, 200, { ok: true, login, mode }, {
          action: "server.players.force-spectator",
          success: true,
          detail: { login, mode }
        });
      }

      if (method === "GET" && url.pathname === "/elite/state") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        return await this.writeJson(response, 200, elitePlugin.getStateSnapshot());
      }

      if (method === "POST" && url.pathname === "/elite/pause") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        const state = await elitePlugin.pauseMatch();
        this.sseHub.publish("elite.pause", { paused: true, state });
        return await this.writeJson(response, 200, state, {
          action: "elite.pause",
          success: true
        });
      }

      if (method === "POST" && url.pathname === "/elite/resume") {
        const elitePlugin = this.getElitePlugin();
        if (!elitePlugin) {
          return this.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
        }
        const state = await elitePlugin.resumeMatch();
        this.sseHub.publish("elite.resume", { paused: false, state });
        return await this.writeJson(response, 200, state, {
          action: "elite.resume",
          success: true
        });
      }

      if (method === "GET" && url.pathname === "/mx/search") {
        const mxPlugin = this.getManiaExchangePlugin();
        if (!mxPlugin) {
          return this.writeJson(response, 503, { error: "maniaexchange plugin is not enabled" });
        }
        const query = url.searchParams.get("q") ?? "";
        const results = await mxPlugin.searchMaps(query);
        return await this.writeJson(response, 200, {
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
          return await this.writeJson(response, 400, { error: "mapId must be a positive integer" });
        }

        const result = await mxPlugin.importMapById(mapId);
        this.sseHub.publish("mx.import", {
          mapId,
          mapName: result.map.gbxMapName ?? result.map.name,
          fileName: result.serverFileName
        });
        return await this.writeJson(response, 200, result, {
          action: "mx.import",
          success: true,
          detail: { mapId }
        });
      }

      if (method === "GET" && url.pathname === "/admin/audit") {
        const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
        const entries = await this.auditLog.readRecent(limit);
        return await this.writeJson(response, 200, {
          count: entries.length,
          entries
        });
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

      await this.writeJson(response, 404, { error: "not found" });
    } catch (error) {
      this.logger.error({ error, method, path: url.pathname }, "Admin API request failed");
      await this.writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error)
      }, {
        action: `error:${url.pathname}`,
        success: false,
        detail: {
          message: error instanceof Error ? error.message : String(error)
        }
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

  private async writeJson(
    response: ServerResponse,
    statusCode: number,
    body: unknown,
    audit?: { action: string; success: boolean; detail?: Record<string, unknown> }
  ): Promise<void> {
    if (audit) {
      await this.auditLog.append({
        timestamp: new Date().toISOString(),
        action: audit.action,
        method: response.req?.method ?? "UNKNOWN",
        path: response.req?.url ?? "",
        client: response.req?.socket.remoteAddress,
        success: audit.success,
        detail: audit.detail
      });
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isXmlRpcValue(value: unknown): value is XmlRpcValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isXmlRpcValue(item));
  }

  if (isRecord(value)) {
    return Object.values(value).every((item) => isXmlRpcValue(item));
  }

  return false;
}

function isXmlRpcStruct(value: unknown): value is Record<string, XmlRpcValue> {
  return isRecord(value) && Object.values(value).every((item) => isXmlRpcValue(item));
}
