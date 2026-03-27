import type { IncomingMessage, ServerResponse } from "node:http";

import type { XmlRpcValue } from "../xmlrpc/types.js";
import type { AdminRouteContext } from "./route-context.js";
import type { ResolvedAdminAuth } from "./types.js";

export async function handleAdminWriteRoute(
  context: AdminRouteContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  auth: ResolvedAdminAuth
): Promise<boolean> {
  if (url.pathname === "/server/maps/choose-next") {
    if (!hasScope(auth, "maps.write")) {
      await context.writeForbidden(response, auth, "maps.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    if (!fileName) {
      await context.writeJson(response, 400, { error: "fileName is required" });
      return true;
    }

    await context.client.chooseNextMap(fileName);
    const nextMap = await context.client.getNextMapInfo();
    context.sseHub.publish("server.nextMapChanged", { fileName, nextMap });
    await context.writeJson(response, 200, nextMap, {
      action: "server.maps.choose-next",
      success: true,
      detail: { fileName }
    });
    return true;
  }

  if (url.pathname === "/server/mode-script-settings") {
    if (!hasScope(auth, "mode.write")) {
      await context.writeForbidden(response, auth, "mode.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const settings = isXmlRpcStruct(body.settings) ? body.settings : isXmlRpcStruct(body) ? body : null;
    if (!settings) {
      await context.writeJson(response, 400, { error: "settings object is required" });
      return true;
    }

    await context.client.setModeScriptSettings(settings);
    const nextSettings = await context.client.getModeScriptSettings();
    context.sseHub.publish("server.modeScriptSettingsChanged", { settings: nextSettings });
    await context.writeJson(response, 200, nextSettings, {
      action: "server.mode-script-settings.update",
      success: true
    });
    return true;
  }

  if (url.pathname === "/server/mode/apply-preset") {
    if (!hasScope(auth, "mode.write")) {
      await context.writeForbidden(response, auth, "mode.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const presetId = typeof body.presetId === "string" ? body.presetId.trim() : "";
    if (!presetId) {
      await context.writeJson(response, 400, { error: "presetId is required" });
      return true;
    }

    const preset = context.config.modePresets.find((entry) => entry.id === presetId);
    if (!preset) {
      await context.writeJson(response, 404, { error: "unknown preset" });
      return true;
    }
    const catalog = await context.getModeCatalog();
    const catalogEntry = catalog.find((entry) => entry.id === presetId);
    if (catalogEntry?.status.checksAvailable && !catalogEntry.status.canApply) {
      await context.writeJson(response, 409, {
        error: "preset assets missing",
        presetId,
        status: catalogEntry.status
      });
      return true;
    }

    if (preset.matchSettings) {
      await context.client.loadMatchSettings(preset.matchSettings);
    }
    if (preset.scriptName) {
      await context.client.setScriptName(preset.scriptName);
    }
    if (preset.modeSettings && isXmlRpcStruct(preset.modeSettings)) {
      await context.client.setModeScriptSettings(preset.modeSettings);
    }
    if (preset.restartAfterApply) {
      await context.client.restartMap();
    }

    const modeScriptInfo = await context.client.getModeScriptInfo().catch(() => undefined);
    const modeScriptSettings = await context.client.getModeScriptSettings().catch(() => undefined);
    context.sseHub.publish("server.modePresetApplied", {
      presetId: preset.id,
      label: preset.label,
      scriptName: preset.scriptName,
      matchSettings: preset.matchSettings,
      restartAfterApply: preset.restartAfterApply
    });
    await context.writeJson(response, 200, {
      ok: true,
      preset: {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        scriptName: preset.scriptName,
        matchSettings: preset.matchSettings,
        restartAfterApply: preset.restartAfterApply,
        status: catalogEntry?.status
      },
      modeScriptInfo,
      modeScriptSettings
    }, {
      action: "server.mode-preset.apply",
      success: true,
      detail: {
        presetId: preset.id,
        label: preset.label,
        scriptName: preset.scriptName,
        matchSettings: preset.matchSettings,
        restartAfterApply: preset.restartAfterApply
      }
    });
    return true;
  }

  if (url.pathname === "/server/mode-script-commands") {
    if (!hasScope(auth, "mode.write")) {
      await context.writeForbidden(response, auth, "mode.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const commands = isXmlRpcStruct(body.commands) ? body.commands : isXmlRpcStruct(body) ? body : null;
    if (!commands) {
      await context.writeJson(response, 400, { error: "commands object is required" });
      return true;
    }

    await context.client.sendModeScriptCommands(commands);
    context.sseHub.publish("server.modeScriptCommandsSent", { commands });
    await context.writeJson(response, 200, { ok: true, commands }, {
      action: "server.mode-script-commands.send",
      success: true
    });
    return true;
  }

  if (url.pathname === "/server/maps/jump") {
    if (!hasScope(auth, "maps.write")) {
      await context.writeForbidden(response, auth, "maps.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const uId = typeof body.uId === "string" ? body.uId.trim() : "";
    if (!uId) {
      await context.writeJson(response, 400, { error: "uId is required" });
      return true;
    }

    await context.client.jumpToMapIdent(uId);
    const currentMap = await context.client.getCurrentMapInfo();
    context.sseHub.publish("server.mapJumped", { uId, currentMap });
    await context.writeJson(response, 200, currentMap, {
      action: "server.maps.jump",
      success: true,
      detail: { uId }
    });
    return true;
  }

  if (url.pathname === "/server/maps/restart") {
    if (!hasScope(auth, "maps.write")) {
      await context.writeForbidden(response, auth, "maps.write");
      return true;
    }

    await context.client.restartMap();
    const currentMap = await context.client.getCurrentMapInfo();
    context.sseHub.publish("server.mapRestarted", { currentMap });
    await context.writeJson(response, 200, currentMap, {
      action: "server.maps.restart",
      success: true,
      detail: { currentMap: currentMap.fileName ?? currentMap.uId ?? currentMap.name ?? "unknown" }
    });
    return true;
  }

  if (url.pathname === "/server/maps/next") {
    if (!hasScope(auth, "maps.write")) {
      await context.writeForbidden(response, auth, "maps.write");
      return true;
    }

    await context.client.nextMap();
    const currentMap = await context.client.getCurrentMapInfo();
    const nextMap = await context.client.getNextMapInfo().catch(() => undefined);
    context.sseHub.publish("server.nextMapTriggered", { currentMap, nextMap });
    await context.writeJson(response, 200, { currentMap, nextMap }, {
      action: "server.maps.next",
      success: true,
      detail: {
        currentMap: currentMap.fileName ?? currentMap.uId ?? currentMap.name ?? "unknown",
        nextMap: nextMap?.fileName ?? nextMap?.uId ?? nextMap?.name ?? undefined
      }
    });
    return true;
  }

  if (url.pathname === "/server/players/kick") {
    if (!hasScope(auth, "players.write")) {
      await context.writeForbidden(response, auth, "players.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!login) {
      await context.writeJson(response, 400, { error: "login is required" });
      return true;
    }

    await context.client.kick(login, message);
    context.sseHub.publish("server.playerKicked", { login, message });
    await context.writeJson(response, 200, { ok: true, login }, {
      action: "server.players.kick",
      success: true,
      detail: { login }
    });
    return true;
  }

  if (url.pathname === "/server/players/force-team") {
    if (!hasScope(auth, "players.write")) {
      await context.writeForbidden(response, auth, "players.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const team = typeof body.team === "number" ? body.team : Number(body.team);
    if (!login || ![0, 1].includes(team)) {
      await context.writeJson(response, 400, { error: "login and team(0|1) are required" });
      return true;
    }

    await context.client.forcePlayerTeam(login, team as 0 | 1);
    context.sseHub.publish("server.playerTeamForced", { login, team });
    await context.writeJson(response, 200, { ok: true, login, team }, {
      action: "server.players.force-team",
      success: true,
      detail: { login, team }
    });
    return true;
  }

  if (url.pathname === "/server/players/force-spectator") {
    if (!hasScope(auth, "players.write")) {
      await context.writeForbidden(response, auth, "players.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const mode = typeof body.mode === "number" ? body.mode : Number(body.mode);
    if (!login || ![0, 1, 2, 3].includes(mode)) {
      await context.writeJson(response, 400, { error: "login and mode(0..3) are required" });
      return true;
    }

    await context.client.forceSpectator(login, mode as 0 | 1 | 2 | 3);
    context.sseHub.publish("server.playerSpectatorForced", { login, mode });
    await context.writeJson(response, 200, { ok: true, login, mode }, {
      action: "server.players.force-spectator",
      success: true,
      detail: { login, mode }
    });
    return true;
  }

  if (url.pathname === "/server/players/ban") {
    if (!hasScope(auth, "players.sanctions.write")) {
      await context.writeForbidden(response, auth, "players.sanctions.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const message = typeof body.message === "string" ? body.message : "";
    const addToBlacklist = body.addToBlacklist === true;
    const saveBlacklist = body.saveBlacklist === true;
    if (!login) {
      await context.writeJson(response, 400, { error: "login is required" });
      return true;
    }

    if (addToBlacklist) {
      await context.client.banAndBlackList(login, message, saveBlacklist);
    } else {
      await context.client.ban(login, message);
    }
    context.sseHub.publish("server.playerBanned", { login, addToBlacklist, saveBlacklist });
    await context.writeJson(response, 200, {
      ok: true,
      login,
      addToBlacklist,
      saveBlacklist
    }, {
      action: addToBlacklist ? "server.players.ban-and-blacklist" : "server.players.ban",
      success: true,
      detail: { login, addToBlacklist, saveBlacklist }
    });
    return true;
  }

  if (url.pathname === "/server/players/unban") {
    if (!hasScope(auth, "players.sanctions.write")) {
      await context.writeForbidden(response, auth, "players.sanctions.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    if (!login) {
      await context.writeJson(response, 400, { error: "login is required" });
      return true;
    }

    await context.client.unBan(login);
    context.sseHub.publish("server.playerUnbanned", { login });
    await context.writeJson(response, 200, { ok: true, login }, {
      action: "server.players.unban",
      success: true,
      detail: { login }
    });
    return true;
  }

  if (url.pathname === "/server/players/blacklist") {
    if (!hasScope(auth, "players.sanctions.write")) {
      await context.writeForbidden(response, auth, "players.sanctions.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    if (!login) {
      await context.writeJson(response, 400, { error: "login is required" });
      return true;
    }

    await context.client.blackList(login);
    context.sseHub.publish("server.playerBlacklisted", { login });
    await context.writeJson(response, 200, { ok: true, login }, {
      action: "server.players.blacklist",
      success: true,
      detail: { login }
    });
    return true;
  }

  if (url.pathname === "/server/players/unblacklist") {
    if (!hasScope(auth, "players.sanctions.write")) {
      await context.writeForbidden(response, auth, "players.sanctions.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    if (!login) {
      await context.writeJson(response, 400, { error: "login is required" });
      return true;
    }

    await context.client.unBlackList(login);
    context.sseHub.publish("server.playerUnblacklisted", { login });
    await context.writeJson(response, 200, { ok: true, login }, {
      action: "server.players.unblacklist",
      success: true,
      detail: { login }
    });
    return true;
  }

  if (url.pathname === "/server/chat/message") {
    if (!hasScope(auth, "chat.write")) {
      await context.writeForbidden(response, auth, "chat.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const recipients = Array.isArray(body.recipients)
      ? body.recipients.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined;
    if (!message) {
      await context.writeJson(response, 400, { error: "message is required" });
      return true;
    }

    await context.client.chatSendServerMessage(message, recipients);
    context.sseHub.publish("server.chatMessageSent", { message, recipients });
    await context.writeJson(response, 200, {
      ok: true,
      message,
      recipients: recipients ?? []
    }, {
      action: "server.chat.message",
      success: true,
      detail: {
        message,
        recipientCount: recipients?.length ?? 0
      }
    });
    return true;
  }

  if (url.pathname === "/server/chat/notice") {
    if (!hasScope(auth, "chat.write")) {
      await context.writeForbidden(response, auth, "chat.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const recipients = Array.isArray(body.recipients)
      ? body.recipients.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined;
    const avatarLogin = typeof body.avatarLogin === "string" ? body.avatarLogin.trim() : "";
    const variant = typeof body.variant === "number" ? body.variant : Number(body.variant ?? 0);
    if (!message) {
      await context.writeJson(response, 400, { error: "message is required" });
      return true;
    }

    await context.client.sendNotice(message, recipients, avatarLogin || undefined, Number.isFinite(variant) ? variant : 0);
    context.sseHub.publish("server.noticeSent", { message, recipients, avatarLogin, variant });
    await context.writeJson(response, 200, {
      ok: true,
      message,
      recipients: recipients ?? [],
      avatarLogin,
      variant: Number.isFinite(variant) ? variant : 0
    }, {
      action: "server.chat.notice",
      success: true,
      detail: {
        message,
        recipientCount: recipients?.length ?? 0,
        avatarLogin: avatarLogin || undefined,
        variant: Number.isFinite(variant) ? variant : 0
      }
    });
    return true;
  }

  if (url.pathname === "/server/votes/call") {
    if (!hasScope(auth, "votes.write")) {
      await context.writeForbidden(response, auth, "votes.write");
      return true;
    }
    const body = await context.readJsonBody(request);
    const command = typeof body.command === "string" ? body.command.trim() : "";
    const ratio = typeof body.ratio === "number" ? body.ratio : Number(body.ratio ?? -1);
    const timeout = typeof body.timeout === "number" ? body.timeout : Number(body.timeout ?? 0);
    const voters = typeof body.voters === "number" ? body.voters : Number(body.voters ?? 0);
    if (!command) {
      await context.writeJson(response, 400, { error: "command is required" });
      return true;
    }

    const xmlRpcRequest = buildXmlRpcVoteRequest(command);
    if (
      Number.isFinite(ratio) && ratio !== -1
      || Number.isFinite(timeout) && timeout !== 0
      || Number.isFinite(voters) && voters !== 0
    ) {
      await context.client.callVoteEx(
        xmlRpcRequest,
        Number.isFinite(ratio) ? ratio : -1,
        Number.isFinite(timeout) ? timeout : 0,
        Number.isFinite(voters) ? voters : 0
      );
    } else {
      await context.client.callVote(xmlRpcRequest);
    }

    context.sseHub.publish("server.voteCalled", {
      command,
      ratio: Number.isFinite(ratio) ? ratio : -1,
      timeout: Number.isFinite(timeout) ? timeout : 0,
      voters: Number.isFinite(voters) ? voters : 0
    });
    await context.writeJson(response, 200, {
      ok: true,
      command,
      ratio: Number.isFinite(ratio) ? ratio : -1,
      timeout: Number.isFinite(timeout) ? timeout : 0,
      voters: Number.isFinite(voters) ? voters : 0
    }, {
      action: "server.votes.call",
      success: true,
      detail: {
        command,
        ratio: Number.isFinite(ratio) ? ratio : -1,
        timeout: Number.isFinite(timeout) ? timeout : 0,
        voters: Number.isFinite(voters) ? voters : 0
      }
    });
    return true;
  }

  if (url.pathname === "/elite/pause") {
    if (!hasScope(auth, "elite.write")) {
      await context.writeForbidden(response, auth, "elite.write");
      return true;
    }
    const elitePlugin = context.getElitePlugin();
    if (!elitePlugin) {
      await context.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
      return true;
    }
    const state = await elitePlugin.pauseMatch();
    context.sseHub.publish("elite.pause", { paused: true, state });
    await context.writeJson(response, 200, state, {
      action: "elite.pause",
      success: true
    });
    return true;
  }

  if (url.pathname === "/elite/resume") {
    if (!hasScope(auth, "elite.write")) {
      await context.writeForbidden(response, auth, "elite.write");
      return true;
    }
    const elitePlugin = context.getElitePlugin();
    if (!elitePlugin) {
      await context.writeJson(response, 503, { error: "shootmania-elite plugin is not enabled" });
      return true;
    }
    const state = await elitePlugin.resumeMatch();
    context.sseHub.publish("elite.resume", { paused: false, state });
    await context.writeJson(response, 200, state, {
      action: "elite.resume",
      success: true
    });
    return true;
  }

  if (url.pathname === "/mx/import") {
    if (!hasScope(auth, "mx.write")) {
      await context.writeForbidden(response, auth, "mx.write");
      return true;
    }
    const mxPlugin = context.getManiaExchangePlugin();
    if (!mxPlugin) {
      await context.writeJson(response, 503, { error: "maniaexchange plugin is not enabled" });
      return true;
    }

    const body = await context.readJsonBody(request);
    const mapId = typeof body.mapId === "number" ? body.mapId : Number(body.mapId);
    if (!Number.isInteger(mapId) || mapId <= 0) {
      await context.writeJson(response, 400, { error: "mapId must be a positive integer" });
      return true;
    }

    const result = await mxPlugin.importMapById(mapId);
    context.sseHub.publish("mx.import", {
      mapId,
      mapName: result.map.gbxMapName ?? result.map.name,
      fileName: result.serverFileName
    });
    await context.writeJson(response, 200, result, {
      action: "mx.import",
      success: true,
      detail: { mapId }
    });
    return true;
  }

  return false;
}

function hasScope(auth: ResolvedAdminAuth, requiredScope: string): boolean {
  if (auth.scopes.includes("*") || auth.scopes.includes(requiredScope)) {
    return true;
  }

  const [prefix] = requiredScope.split(".", 1);
  return Boolean(prefix && auth.scopes.includes(`${prefix}.*`));
}

function isXmlRpcStruct(value: unknown): value is Record<string, XmlRpcValue> {
  return isRecord(value) && Object.values(value).every((item) => isXmlRpcValue(item));
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

function buildXmlRpcVoteRequest(command: string): string {
  const escaped = command
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
  return `<?xml version="1.0"?><methodCall><methodName>${escaped}</methodName><params></params></methodCall>`;
}
