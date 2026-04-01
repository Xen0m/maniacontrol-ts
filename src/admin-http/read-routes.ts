import type { IncomingMessage, ServerResponse } from "node:http";

import type { AdminRouteContext } from "./route-context.js";
import type { ResolvedAdminAuth } from "./types.js";

export async function handleAdminReadRoute(
  context: AdminRouteContext,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  auth: ResolvedAdminAuth
): Promise<boolean> {
  if (url.pathname === "/health") {
    await context.writeJson(response, 200, {
      status: "ok",
      startedAt: context.getSnapshot().startedAt,
      admin: {
        realtimeClients: context.sseHub.getClientCount()
      },
      auth: {
        id: auth.id,
        label: auth.label,
        role: auth.role,
        scopes: auth.scopes
      },
      dedicated: {
        version: context.getSnapshot().version,
        systemInfo: context.getSnapshot().systemInfo
      }
    });
    return true;
  }

  if (url.pathname === "/server/info") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const status = await context.client.getStatus();
    const gameMode = await context.client.getGameMode();
    await context.writeJson(response, 200, {
      ...context.getSnapshot(),
      status,
      gameMode
    });
    return true;
  }

  if (url.pathname === "/server/mode-script-info") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const modeScriptInfo = await context.client.getModeScriptInfo();
    await context.writeJson(response, 200, modeScriptInfo);
    return true;
  }

  if (url.pathname === "/server/mode/presets") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const catalog = await context.getModeCatalog();
    await context.writeJson(response, 200, {
      count: catalog.length,
      serverFilesRoot: context.config.serverFilesRoot,
      presets: catalog.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        scriptName: preset.scriptName,
        scriptSourcePath: preset.scriptSourcePath,
        matchSettings: preset.matchSettings,
        matchSettingsSourcePath: preset.matchSettingsSourcePath,
        restartAfterApply: preset.restartAfterApply,
        status: preset.status
      }))
    });
    return true;
  }

  if (url.pathname === "/server/mode/catalog") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const catalog = await context.getModeCatalog();
    await context.writeJson(response, 200, {
      count: catalog.length,
      serverFilesRoot: context.config.serverFilesRoot,
      presets: catalog
    });
    return true;
  }

  if (url.pathname === "/server/mode-script-settings") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const settings = await context.client.getModeScriptSettings();
    await context.writeJson(response, 200, settings);
    return true;
  }

  if (url.pathname === "/server/maps/current") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const currentMap = await context.client.getCurrentMapInfo();
    await context.writeJson(response, 200, currentMap);
    return true;
  }

  if (url.pathname === "/server/maps/next") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const nextMap = await context.client.getNextMapInfo();
    await context.writeJson(response, 200, nextMap);
    return true;
  }

  if (url.pathname === "/server/maps") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const maps = await context.client.getMapList(limit, offset);
    await context.writeJson(response, 200, {
      offset,
      limit,
      count: maps.length,
      maps
    });
    return true;
  }

  if (url.pathname === "/server/ranking/current") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const entries = await context.client.getCurrentRanking(limit, offset);
    const winnerTeam = await context.client.getCurrentWinnerTeam().catch(() => undefined);
    await context.writeJson(response, 200, {
      offset,
      limit,
      count: entries.length,
      winnerTeam,
      entries
    });
    return true;
  }

  if (url.pathname === "/records/local/current-map") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const currentMap = await context.client.getCurrentMapInfo();
    const snapshot = await context.localRecordsStore.getCurrentMapRecords(currentMap.uId);
    await context.writeJson(response, 200, {
      currentMap,
      records: snapshot
    });
    return true;
  }

  if (url.pathname === "/records/local/maps") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);
    const maps = await context.localRecordsStore.listMaps(limit);
    await context.writeJson(response, 200, {
      count: maps.length,
      maps
    });
    return true;
  }

  if (url.pathname === "/server/players") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const players = await context.client.getPlayerList(100, 0, 1);
    const detailedPlayers = await Promise.all(
      players.map(async (player) => {
        if (!player.login) return player;
        try {
          return {
            ...player,
            ...(await context.client.getDetailedPlayerInfo(player.login))
          };
        } catch {
          return player;
        }
      })
    );
    await context.writeJson(response, 200, {
      count: detailedPlayers.length,
      players: detailedPlayers
    });
    return true;
  }

  if (url.pathname === "/server/players/banlist") {
    if (!hasScope(auth, "players.sanctions.read")) {
      await context.writeForbidden(response, auth, "players.sanctions.read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const players = await context.client.getBanList(limit, offset);
    await context.writeJson(response, 200, {
      offset,
      limit,
      count: players.length,
      players
    });
    return true;
  }

  if (url.pathname === "/server/players/blacklist") {
    if (!hasScope(auth, "players.sanctions.read")) {
      await context.writeForbidden(response, auth, "players.sanctions.read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const players = await context.client.getBlackList(limit, offset);
    await context.writeJson(response, 200, {
      offset,
      limit,
      count: players.length,
      players
    });
    return true;
  }

  if (url.pathname === "/elite/state") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const elitePlugin = context.getElitePlugin();
    if (!elitePlugin) {
      await context.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
      return true;
    }
    await context.writeJson(response, 200, elitePlugin.getStateSnapshot());
    return true;
  }

  if (url.pathname === "/mx/search") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    const mxPlugin = context.getManiaExchangePlugin();
    if (!mxPlugin) {
      await context.writeJson(response, 503, { error: "maniaexchange plugin is not enabled" });
      return true;
    }
    const query = url.searchParams.get("q") ?? "";
    const results = await mxPlugin.searchMaps(query);
    await context.writeJson(response, 200, {
      query,
      results
    });
    return true;
  }

  if (url.pathname === "/admin/audit") {
    if (!hasScope(auth, "audit.read")) {
      await context.writeForbidden(response, auth, "audit.read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const entries = await context.auditLog.readRecent(limit);
    await context.writeJson(response, 200, {
      count: entries.length,
      entries
    });
    return true;
  }

  if (url.pathname === "/admin/activity") {
    if (!hasScope(auth, "audit.read")) {
      await context.writeForbidden(response, auth, "audit.read");
      return true;
    }
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
    const category = url.searchParams.get("category")?.trim() || undefined;
    const login = url.searchParams.get("login")?.trim() || undefined;
    const entries = await context.activityLog.readRecent({ limit, category, login });
    await context.writeJson(response, 200, {
      count: entries.length,
      entries
    });
    return true;
  }

  if (url.pathname === "/events") {
    if (!hasScope(auth, "read")) {
      await context.writeForbidden(response, auth, "read");
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    response.write("\n");
    context.sseHub.addClient(response);
    context.sseHub.publish("system.connected", {
      clientCount: context.sseHub.getClientCount()
    });
    return true;
  }

  return false;
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function hasScope(auth: ResolvedAdminAuth, requiredScope: string): boolean {
  if (auth.scopes.includes("*") || auth.scopes.includes(requiredScope)) {
    return true;
  }

  const [prefix] = requiredScope.split(".", 1);
  return Boolean(prefix && auth.scopes.includes(`${prefix}.*`));
}
