import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import type { CallbackBus } from "../core/callbacks.js";
import type { DedicatedClient } from "../transport/dedicated-client.js";
import { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";
import { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { SseHub } from "./sse-hub.js";
import { AdminAuditLog } from "./audit-log.js";
import { AdminActivityLog } from "./activity-log.js";
import { LocalRecordsStore } from "./local-records-store.js";
import { buildModeCatalog } from "../modes/mode-catalog.js";
import { installModePresetAssets } from "../modes/mode-preset-assets.js";
import { handleAdminReadRoute } from "./read-routes.js";
import { handleAdminWriteRoute } from "./write-routes.js";
import type { AdminRouteContext } from "./route-context.js";
import type {
  AdminAuditContext,
  AdminRole,
  AuthorizedIncomingMessage,
  ControllerSnapshot,
  ResolvedAdminAuth
} from "./types.js";

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
  private readonly activityLog: AdminActivityLog;
  private readonly localRecordsStore: LocalRecordsStore;
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
    this.activityLog = new AdminActivityLog(this.config.activityPath);
    this.localRecordsStore = new LocalRecordsStore(this.config.localRecordsPath);
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
      void this.appendActivity({
        category: "elite",
        type: "elite.stateChanged",
        summary: "Elite state updated",
        payload: { reason: readReasonFromEvent(event) }
      });
    });
    this.callbacks.on("ManiaPlanet.BeginMap", (event) => {
      this.sseHub.publish("server.beginMap", event);
      void this.appendActivity({
        category: "maps",
        type: "server.beginMap",
        summary: "Map started",
        payload: { params: sanitizeParams(event.params) }
      });
    });
    this.callbacks.on("ManiaPlanet.EndMap", (event) => {
      this.sseHub.publish("server.endMap", event);
      void this.appendActivity({
        category: "maps",
        type: "server.endMap",
        summary: "Map ended",
        payload: { params: sanitizeParams(event.params) }
      });
      void this.captureRankingSnapshot("map-end");
      void this.captureLocalRecordsSnapshot();
    });
    this.callbacks.on("ManiaPlanet.PlayerConnect", (event) => {
      this.sseHub.publish("server.playerConnect", event);
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      void this.appendActivity({
        category: "players",
        type: "server.playerConnect",
        summary: login ? `${login} connected` : "Player connected",
        login,
        payload: { params: sanitizeParams(event.params) }
      });
    });
    this.callbacks.on("ManiaPlanet.PlayerDisconnect", (event) => {
      this.sseHub.publish("server.playerDisconnect", event);
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      void this.appendActivity({
        category: "players",
        type: "server.playerDisconnect",
        summary: login ? `${login} disconnected` : "Player disconnected",
        login,
        payload: { params: sanitizeParams(event.params) }
      });
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

  private createRouteContext(): AdminRouteContext {
    return {
      config: this.config,
      client: this.client,
      sseHub: this.sseHub,
      auditLog: this.auditLog,
      activityLog: this.activityLog,
      localRecordsStore: this.localRecordsStore,
      getSnapshot: this.getSnapshot,
      getElitePlugin: this.getElitePlugin,
      getManiaExchangePlugin: this.getManiaExchangePlugin,
      getModeCatalog: this.getModeCatalog.bind(this),
      installModePresetAssets: this.installModePresetAssets.bind(this),
      readJsonBody: this.readJsonBody.bind(this),
      writeJson: this.writeJson.bind(this),
      writeForbidden: this.writeForbidden.bind(this)
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const auth = this.resolveAuthorization(request);

    if (!auth) {
      return this.writeJson(response, 401, {
        error: "unauthorized"
      });
    }
    (request as AuthorizedIncomingMessage).adminAuth = auth;

    try {
      const routeContext = this.createRouteContext();

      if (method === "GET" && await handleAdminReadRoute(routeContext, request, response, url, auth)) {
        return;
      }

      if (method === "POST" && await handleAdminWriteRoute(routeContext, request, response, url, auth)) {
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

  private resolveAuthorization(request: IncomingMessage): ResolvedAdminAuth | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, token] = header.split(/\s+/, 2);
    if (scheme !== "Bearer" || !token) {
      return null;
    }

    for (const principal of this.config.principals ?? []) {
      if (principal.token !== token) {
        continue;
      }
      return {
        id: principal.id,
        label: principal.label,
        role: principal.role,
        scopes: principal.scopes.length > 0 ? principal.scopes : defaultScopesForRole(principal.role)
      };
    }

    if (this.config.token && token === this.config.token) {
      return {
        id: "legacy-admin",
        label: "Legacy Admin Token",
        role: "owner",
        scopes: ["*"]
      };
    }

    return null;
  }

  private async writeForbidden(
    response: ServerResponse,
    auth: ResolvedAdminAuth,
    requiredScope: string
  ): Promise<void> {
    await this.writeJson(response, 403, {
      error: "forbidden",
      role: auth.role,
      requiredScope
    });
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
    audit?: AdminAuditContext
  ): Promise<void> {
    if (audit) {
      const auth = (response.req as AuthorizedIncomingMessage | undefined)?.adminAuth;
      await this.auditLog.append({
        timestamp: new Date().toISOString(),
        action: audit.action,
        method: response.req?.method ?? "UNKNOWN",
        path: response.req?.url ?? "",
        client: response.req?.socket.remoteAddress,
        actorId: auth?.id,
        actorLabel: auth?.label,
        actorRole: auth?.role,
        success: audit.success,
        detail: audit.detail
      });
      await this.maybeLogActionToChat(response, audit);
      await this.appendActivityFromAudit(response, audit);
    }
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(body, null, 2));
  }

  private async maybeLogActionToChat(
    response: ServerResponse,
    audit: AdminAuditContext
  ): Promise<void> {
    if (!this.config.chatLoggingEnabled || !audit.success) {
      return;
    }

    const method = response.req?.method ?? "";
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return;
    }

    const message = formatAdminActionChatMessage(audit.action, audit.detail);
    if (!message) {
      return;
    }

    try {
      await this.client.chatSendServerMessage(message);
    } catch (error) {
      this.logger.warn({ error, action: audit.action }, "failed to send admin action chat log");
    }
  }

  private async appendActivityFromAudit(
    response: ServerResponse,
    audit: AdminAuditContext
  ): Promise<void> {
    const auth = (response.req as AuthorizedIncomingMessage | undefined)?.adminAuth;
    await this.appendActivity({
      category: classifyActivityCategory(audit.action),
      type: audit.action,
      summary: summarizeAuditAction(audit.action, audit.detail),
      login: typeof audit.detail?.login === "string" ? audit.detail.login : undefined,
      actorId: auth?.id,
      actorRole: auth?.role,
      payload: audit.detail
    });
  }

  private async appendActivity(entry: {
    category: string;
    type: string;
    summary: string;
    login?: string;
    actorId?: string;
    actorRole?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.activityLog.append({
      timestamp: new Date().toISOString(),
      ...entry
    });
  }

  private async getModeCatalog() {
    return buildModeCatalog({
      modePresets: this.config.modePresets,
      serverFilesRoot: this.config.serverFilesRoot
    });
  }

  private async installModePresetAssets(presetId: string) {
    const preset = this.config.modePresets.find((entry) => entry.id === presetId);
    if (!preset) {
      throw new Error(`Unknown mode preset "${presetId}".`);
    }
    return installModePresetAssets(preset, this.config.serverFilesRoot);
  }

  private async captureRankingSnapshot(trigger: string): Promise<void> {
    try {
      const entries = await this.client.getCurrentRanking(10, 0);
      const winnerTeam = await this.client.getCurrentWinnerTeam().catch(() => undefined);
      if (entries.length === 0) {
        return;
      }
      await this.appendActivity({
        category: "ranking",
        type: "server.ranking.snapshot",
        summary: "Captured ranking snapshot",
        payload: {
          trigger,
          winnerTeam,
          entries
        }
      });
    } catch (error) {
      this.logger.debug({ error, trigger }, "failed to capture ranking snapshot");
    }
  }

  private async captureLocalRecordsSnapshot(): Promise<void> {
    try {
      const currentMap = await this.client.getCurrentMapInfo();
      const ranking = await this.client.getCurrentRanking(20, 0);
      if (!currentMap.uId || ranking.length === 0) {
        return;
      }
      const snapshot = await this.localRecordsStore.recordMapRanking(currentMap, ranking);
      if (!snapshot) {
        return;
      }
      await this.appendActivity({
        category: "records",
        type: "records.local.updated",
        summary: "Updated local records",
        payload: {
          mapUid: snapshot.mapUid,
          mapName: snapshot.mapName,
          topLogin: snapshot.entries[0]?.login
        }
      });
    } catch (error) {
      this.logger.debug({ error }, "failed to capture local records snapshot");
    }
  }
}

function formatAdminActionChatMessage(
  action: string,
  detail?: Record<string, unknown>
): string | null {
  const login = typeof detail?.login === "string" ? detail.login : null;
  const team = typeof detail?.team === "number" ? detail.team : null;
  const mode = typeof detail?.mode === "number" ? detail.mode : null;
  const fileName = typeof detail?.fileName === "string" ? detail.fileName : null;
  const uId = typeof detail?.uId === "string" ? detail.uId : null;
  const mapId = typeof detail?.mapId === "number" ? detail.mapId : null;

  switch (action) {
    case "server.maps.choose-next":
      return `[ManiaControl] Next map set to ${fileName ?? "unknown map"}`;
    case "server.maps.jump":
      return `[ManiaControl] Jumped to map ${uId ?? "unknown map"}`;
    case "server.maps.restart":
      return "[ManiaControl] Restarted current map";
    case "server.maps.next":
      return "[ManiaControl] Advanced to next map";
    case "server.players.kick":
      return login ? `[ManiaControl] Kicked ${login}` : "[ManiaControl] Player kicked";
    case "server.players.force-team":
      if (!login || team === null) {
        return "[ManiaControl] Team assignment updated";
      }
      return `[ManiaControl] Moved ${login} to Team ${team + 1}`;
    case "server.players.force-spectator":
      if (!login || mode === null) {
        return "[ManiaControl] Spectator state updated";
      }
      if (mode === 1 || mode === 3) {
        return `[ManiaControl] Moved ${login} to spectator`;
      }
      if (mode === 2) {
        return `[ManiaControl] Restored ${login} as player`;
      }
      return `[ManiaControl] Updated spectator state for ${login}`;
    case "server.players.ban":
      return login ? `[ManiaControl] Banned ${login}` : "[ManiaControl] Player banned";
    case "server.players.ban-and-blacklist":
      return login ? `[ManiaControl] Banned and blacklisted ${login}` : "[ManiaControl] Player banned and blacklisted";
    case "server.players.unban":
      return login ? `[ManiaControl] Unbanned ${login}` : "[ManiaControl] Player unbanned";
    case "server.players.blacklist":
      return login ? `[ManiaControl] Blacklisted ${login}` : "[ManiaControl] Player blacklisted";
    case "server.players.unblacklist":
      return login ? `[ManiaControl] Removed ${login} from blacklist` : "[ManiaControl] Player removed from blacklist";
    case "elite.pause":
      return "[ManiaControl] Match paused";
    case "elite.resume":
      return "[ManiaControl] Match resumed";
    case "mx.import":
      return mapId !== null
        ? `[ManiaControl] Imported SMX map ${mapId}`
        : "[ManiaControl] Imported SMX map";
    case "server.mode-script-settings.update":
      return "[ManiaControl] Updated mode script settings";
    case "server.mode-script-commands.send":
      return "[ManiaControl] Sent mode script commands";
    case "server.mode-preset.apply":
      return "[ManiaControl] Applied mode preset";
    case "server.chat.message":
      return null;
    case "server.chat.notice":
      return null;
    case "server.votes.call":
      return "[ManiaControl] Started a vote";
    default:
      return null;
  }
}

function classifyActivityCategory(action: string): string {
  if (action.startsWith("server.players.")) return "players";
  if (action.startsWith("server.maps.")) return "maps";
  if (action.startsWith("server.ranking.")) return "ranking";
  if (action.startsWith("records.")) return "records";
  if (action.startsWith("server.chat.")) return "chat";
  if (action.startsWith("server.votes.")) return "votes";
  if (action.startsWith("server.mode-script")) return "mode";
  if (action.startsWith("elite.")) return "elite";
  if (action.startsWith("mx.")) return "smx";
  if (action.startsWith("error:")) return "errors";
  return "system";
}

function summarizeAuditAction(action: string, detail?: Record<string, unknown>): string {
  const login = typeof detail?.login === "string" ? detail.login : undefined;
  const fileName = typeof detail?.fileName === "string" ? detail.fileName : undefined;
  const message = typeof detail?.message === "string" ? detail.message : undefined;

  switch (action) {
    case "server.players.kick":
      return login ? `Kicked ${login}` : "Player kicked";
    case "server.players.ban":
      return login ? `Banned ${login}` : "Player banned";
    case "server.players.ban-and-blacklist":
      return login ? `Banned and blacklisted ${login}` : "Player banned and blacklisted";
    case "server.players.unban":
      return login ? `Unbanned ${login}` : "Player unbanned";
    case "server.players.blacklist":
      return login ? `Blacklisted ${login}` : "Player blacklisted";
    case "server.players.unblacklist":
      return login ? `Removed ${login} from blacklist` : "Player removed from blacklist";
    case "server.maps.choose-next":
      return fileName ? `Queued ${fileName} as next map` : "Updated next map";
    case "server.maps.jump":
      return "Jumped to map";
    case "server.maps.restart":
      return "Restarted current map";
    case "server.maps.next":
      return "Advanced to next map";
    case "server.ranking.snapshot":
      return "Captured ranking snapshot";
    case "server.chat.message":
    case "server.chat.notice":
      return message ? `Sent message: ${message}` : "Sent server message";
    case "server.mode-preset.apply":
      return typeof detail?.label === "string" ? `Applied mode preset: ${detail.label}` : "Applied mode preset";
    case "server.votes.call":
      return typeof detail?.command === "string" ? `Started vote: ${detail.command}` : "Started vote";
    case "elite.pause":
      return "Paused match";
    case "elite.resume":
      return "Resumed match";
    case "mx.import":
      return "Imported SMX map";
    default:
      return action;
  }
}

function sanitizeParams(params: unknown[]): Record<string, unknown> {
  return { params: params.map((value) => sanitizeValue(value)) };
}

function sanitizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    return Object.fromEntries(entries.map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return String(value);
}

function readReasonFromEvent(event: { params?: unknown[] }): string | undefined {
  const payload = event.params?.[1];
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const reason = (payload as Record<string, unknown>).reason;
    return typeof reason === "string" ? reason : undefined;
  }
  return undefined;
}

function defaultScopesForRole(role: AdminRole): string[] {
  if (role === "owner") {
    return ["*"];
  }
  if (role === "operator") {
    return [
      "read",
      "players.write",
      "players.sanctions.read",
      "players.sanctions.write",
      "maps.write",
      "elite.write",
      "mode.write",
      "chat.write",
      "votes.write",
      "mx.write",
      "audit.read"
    ];
  }
  return ["read"];
}
