import type { Logger } from "pino";

import { GbxRemoteClient } from "./gbx-remote.js";
import type { XmlRpcCallMessage, XmlRpcValue } from "../xmlrpc/types.js";

export interface DedicatedVersion {
  name?: string;
  titleId?: string;
  version?: string;
  build?: string;
  apiVersion?: string;
}

export interface DedicatedSystemInfo {
  publishedIp?: string;
  port?: number;
  p2PPort?: number;
  serverLogin?: string;
  titleId?: string;
}

export interface ModeScriptCommandDescriptor {
  name?: string;
}

export interface ModeScriptInfo {
  name?: string;
  commandDescs?: ModeScriptCommandDescriptor[];
}

export interface DedicatedMapInfo {
  name?: string;
  uId?: string;
  fileName?: string;
  author?: string;
  environment?: string;
  mapType?: string;
  mapStyle?: string;
}

export interface DedicatedPlayerInfo {
  login?: string;
  nickName?: string;
  playerId?: number;
  teamId?: number;
  isSpectator?: boolean;
  spectatorStatus?: number;
  ladderRanking?: number;
  language?: string;
}

export interface DedicatedPlayerDetailedInfo {
  login?: string;
  nickName?: string;
  playerId?: number;
  teamId?: number;
  isSpectator?: boolean;
  spectatorStatus?: number;
  ladderRanking?: number;
  language?: string;
  ping?: number;
  packetLossRate?: number;
  isInOfficialMode?: boolean;
  isReferee?: boolean;
  isPodiumReady?: boolean;
}

export interface DedicatedSimpleLoginEntry {
  login?: string;
  nickName?: string;
  ipAddress?: string;
}

export interface DedicatedRankingEntry {
  login?: string;
  nickName?: string;
  playerId?: number;
  rank?: number;
  bestTime?: number;
  score?: number;
  nbrLapsFinished?: number;
  ladderScore?: number;
}

export class DedicatedClient {
  private readonly transport: GbxRemoteClient;
  private readonly logger: Logger;

  public constructor(host: string, port: number, timeoutMs: number, logger: Logger) {
    this.transport = new GbxRemoteClient(host, port, timeoutMs);
    this.logger = logger.child({ component: "dedicated-client" });
  }

  public async connect(user: string, password: string, apiVersion: string): Promise<void> {
    await this.transport.connect();
    await this.callBoolean("Authenticate", [user, password]);
    await this.callBoolean("SetApiVersion", [apiVersion]);
  }

  public async enableCallbacks(enabled: boolean): Promise<void> {
    await this.callBoolean("EnableCallbacks", [enabled]);
  }

  public async getVersion(): Promise<DedicatedVersion> {
    const result = await this.callStruct("GetVersion");
    return {
      name: readString(result, "name"),
      titleId: readString(result, "titleId"),
      version: readString(result, "version"),
      build: readString(result, "build"),
      apiVersion: readString(result, "apiVersion")
    };
  }

  public async getStatus(): Promise<Record<string, XmlRpcValue>> {
    return this.callStruct("GetStatus");
  }

  public async getSystemInfo(): Promise<DedicatedSystemInfo> {
    const result = await this.callStruct("GetSystemInfo");
    return {
      publishedIp: readString(result, "publishedIp"),
      port: readNumber(result, "port"),
      p2PPort: readNumber(result, "p2PPort"),
      serverLogin: readString(result, "serverLogin"),
      titleId: readString(result, "titleId")
    };
  }

  public async getGameMode(): Promise<number> {
    const value = await this.transport.call("GetGameMode");
    return Number(value);
  }

  public async getModeScriptSettings(): Promise<Record<string, XmlRpcValue>> {
    return this.callStruct("GetModeScriptSettings");
  }

  public async getModeScriptInfo(): Promise<ModeScriptInfo> {
    const result = await this.callStruct("GetModeScriptInfo");
    return {
      name: readString(result, "name"),
      commandDescs: readStructArray(result, "commandDescs").map((command) => ({
        name: readString(command, "name")
      }))
    };
  }

  public async getMapInfo(fileName: string): Promise<DedicatedMapInfo> {
    const result = await this.callStructWithParams("GetMapInfo", [fileName]);
    return {
      name: readString(result, "name"),
      uId: readString(result, "uId"),
      fileName: readString(result, "fileName"),
      author: readString(result, "author"),
      environment: readString(result, "environment"),
      mapType: readString(result, "mapType"),
      mapStyle: readString(result, "mapStyle")
    };
  }

  public async getCurrentMapInfo(): Promise<DedicatedMapInfo> {
    try {
      const result = await this.callStruct("GetCurrentMapInfo");
      return {
        name: readString(result, "name"),
        uId: readString(result, "uId"),
        fileName: readString(result, "fileName"),
        author: readString(result, "author"),
        environment: readString(result, "environment"),
        mapType: readString(result, "mapType"),
        mapStyle: readString(result, "mapStyle")
      };
    } catch (error) {
      this.logger.debug({ error }, "GetCurrentMapInfo failed, trying legacy fallback");
      const result = await this.callStruct("GetCurrentChallengeInfo");
      return {
        name: readString(result, "name"),
        uId: readString(result, "uId"),
        fileName: readString(result, "fileName"),
        author: readString(result, "author"),
        environment: readString(result, "environment"),
        mapType: readString(result, "mapType"),
        mapStyle: readString(result, "mapStyle")
      };
    }
  }

  public async getNextMapInfo(): Promise<DedicatedMapInfo> {
    try {
      const result = await this.callStruct("GetNextMapInfo");
      return {
        name: readString(result, "name"),
        uId: readString(result, "uId"),
        fileName: readString(result, "fileName"),
        author: readString(result, "author"),
        environment: readString(result, "environment"),
        mapType: readString(result, "mapType"),
        mapStyle: readString(result, "mapStyle")
      };
    } catch (error) {
      this.logger.debug({ error }, "GetNextMapInfo failed, trying legacy fallback");
      const result = await this.callStruct("GetNextChallengeInfo");
      return {
        name: readString(result, "name"),
        uId: readString(result, "uId"),
        fileName: readString(result, "fileName"),
        author: readString(result, "author"),
        environment: readString(result, "environment"),
        mapType: readString(result, "mapType"),
        mapStyle: readString(result, "mapStyle")
      };
    }
  }

  public async getMapList(length = 100, offset = 0): Promise<DedicatedMapInfo[]> {
    const result = await this.transport.call("GetMapList", [length, offset]);
    if (!Array.isArray(result)) {
      throw new Error("GetMapList returned an unexpected payload");
    }

    return result
      .filter((item): item is Record<string, XmlRpcValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        name: readString(item, "name"),
        uId: readString(item, "uId"),
        fileName: readString(item, "fileName"),
        author: readString(item, "author"),
        environment: readString(item, "environment"),
        mapType: readString(item, "mapType"),
        mapStyle: readString(item, "mapStyle")
      }));
  }

  public async chooseNextMap(fileName: string): Promise<void> {
    await this.callBoolean("ChooseNextMap", [fileName]);
  }

  public async jumpToMapIdent(uId: string): Promise<void> {
    await this.callBoolean("JumpToMapIdent", [uId]);
  }

  public async nextMap(): Promise<void> {
    await this.callBoolean("NextMap");
  }

  public async restartMap(): Promise<void> {
    await this.callBoolean("RestartMap");
  }

  public async setScriptName(scriptName: string): Promise<void> {
    await this.callBoolean("SetScriptName", [scriptName]);
  }

  public async loadMatchSettings(fileName: string): Promise<void> {
    await this.callBoolean("LoadMatchSettings", [fileName]);
  }

  public async getPlayerList(length = 100, offset = 0, compatibility = 1): Promise<DedicatedPlayerInfo[]> {
    const result = await this.transport.call("GetPlayerList", [length, offset, compatibility]);
    if (!Array.isArray(result)) {
      throw new Error("GetPlayerList returned an unexpected payload");
    }

    return result
      .filter((item): item is Record<string, XmlRpcValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        login: readString(item, "login"),
        nickName: readString(item, "nickName"),
        playerId: readNumber(item, "playerId"),
        teamId: readNumber(item, "teamId"),
        isSpectator: readBoolean(item, "isSpectator"),
        spectatorStatus: readNumber(item, "spectatorStatus"),
        ladderRanking: readNumber(item, "ladderRanking"),
        language: readString(item, "language"),
      }));
  }

  public async getDetailedPlayerInfo(login: string): Promise<DedicatedPlayerDetailedInfo> {
    const result = await this.callStructWithParams("GetDetailedPlayerInfo", [login]);
    return {
      login: readString(result, "login"),
      nickName: readString(result, "nickName"),
      playerId: readNumber(result, "playerId"),
      teamId: readNumber(result, "teamId"),
      isSpectator: readBoolean(result, "isSpectator"),
      spectatorStatus: readNumber(result, "spectatorStatus"),
      ladderRanking: readNumber(result, "ladderRanking"),
      language: readString(result, "language"),
      ping: readNumber(result, "ping"),
      packetLossRate: readNumber(result, "packetLossRate"),
      isInOfficialMode: readBoolean(result, "isInOfficialMode"),
      isReferee: readBoolean(result, "isReferee"),
      isPodiumReady: readBoolean(result, "isPodiumReady"),
    };
  }

  public async kick(login: string, message = ""): Promise<void> {
    await this.callBoolean("Kick", [login, message]);
  }

  public async forcePlayerTeam(login: string, team: 0 | 1): Promise<void> {
    await this.callBoolean("ForcePlayerTeam", [login, team]);
  }

  public async forceSpectator(login: string, mode: 0 | 1 | 2 | 3): Promise<void> {
    await this.callBoolean("ForceSpectator", [login, mode]);
  }

  public async ban(login: string, message = ""): Promise<void> {
    await this.callBoolean("Ban", [login, message]);
  }

  public async banAndBlackList(login: string, message = "", save = false): Promise<void> {
    await this.callBoolean("BanAndBlackList", [login, message, save]);
  }

  public async unBan(login: string): Promise<void> {
    await this.callBoolean("UnBan", [login]);
  }

  public async getBanList(length = 100, offset = 0): Promise<DedicatedSimpleLoginEntry[]> {
    const result = await this.transport.call("GetBanList", [length, offset]);
    if (!Array.isArray(result)) {
      throw new Error("GetBanList returned an unexpected payload");
    }

    return result
      .filter((item): item is Record<string, XmlRpcValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        login: readString(item, "Login") ?? readString(item, "login"),
        nickName: readString(item, "ClientName") ?? readString(item, "nickName"),
        ipAddress: readString(item, "IPAddress") ?? readString(item, "ipAddress")
      }));
  }

  public async blackList(login: string): Promise<void> {
    await this.callBoolean("BlackList", [login]);
  }

  public async unBlackList(login: string): Promise<void> {
    await this.callBoolean("UnBlackList", [login]);
  }

  public async getBlackList(length = 100, offset = 0): Promise<DedicatedSimpleLoginEntry[]> {
    const result = await this.transport.call("GetBlackList", [length, offset]);
    if (!Array.isArray(result)) {
      throw new Error("GetBlackList returned an unexpected payload");
    }

    return result
      .filter((item): item is Record<string, XmlRpcValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        login: readString(item, "Login") ?? readString(item, "login"),
        nickName: readString(item, "ClientName") ?? readString(item, "nickName"),
        ipAddress: readString(item, "IPAddress") ?? readString(item, "ipAddress")
      }));
  }

  public async getCurrentRanking(length = 100, offset = 0): Promise<DedicatedRankingEntry[]> {
    const result = await this.transport.call("GetCurrentRanking", [length, offset]);
    if (!Array.isArray(result)) {
      throw new Error("GetCurrentRanking returned an unexpected payload");
    }

    return result
      .filter((item): item is Record<string, XmlRpcValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        login: readString(item, "Login") ?? readString(item, "login"),
        nickName: readString(item, "NickName") ?? readString(item, "nickName"),
        playerId: readNumber(item, "PlayerId") ?? readNumber(item, "playerId"),
        rank: readNumber(item, "Rank") ?? readNumber(item, "rank"),
        bestTime: readNumber(item, "BestTime") ?? readNumber(item, "bestTime"),
        score: readNumber(item, "Score") ?? readNumber(item, "score"),
        nbrLapsFinished: readNumber(item, "NbrLapsFinished") ?? readNumber(item, "nbrLapsFinished"),
        ladderScore: readNumber(item, "LadderScore") ?? readNumber(item, "ladderScore")
      }));
  }

  public async getCurrentWinnerTeam(): Promise<number> {
    const result = await this.transport.call("GetCurrentWinnerTeam");
    return Number(result);
  }

  public async addMap(fileName: string): Promise<void> {
    await this.callBoolean("AddMap", [fileName]);
  }

  public async insertMap(fileName: string): Promise<void> {
    await this.callBoolean("InsertMap", [fileName]);
  }

  public async chatSendServerMessage(message: string, recipients?: string[]): Promise<void> {
    if (recipients && recipients.length > 0) {
      // The dedicated server ToLogin variant expects a single login string.
      await this.callBoolean("ChatSendServerMessageToLogin", [message, recipients[0]]);
      return;
    }

    await this.callBoolean("ChatSendServerMessage", [message]);
  }

  public async sendNotice(
    message: string,
    recipients?: string[],
    avatarLogin?: string,
    variant = 0
  ): Promise<void> {
    if (recipients && recipients.length > 0) {
      await this.callBoolean("SendNoticeToLogin", [recipients[0], message, avatarLogin ?? "", variant]);
      return;
    }

    await this.callBoolean("SendNotice", [message, avatarLogin ?? "", variant]);
  }

  public async sendDisplayManialinkPage(
    manialinkXml: string,
    recipients?: string[],
    timeout = 0,
    hideOnClick = false
  ): Promise<void> {
    if (recipients && recipients.length > 0) {
      await this.callBoolean("SendDisplayManialinkPageToLogin", [
        recipients[0],
        manialinkXml,
        timeout,
        hideOnClick
      ]);
      return;
    }

    await this.callBoolean("SendDisplayManialinkPage", [manialinkXml, timeout, hideOnClick]);
  }

  public async sendHideManialinkPage(recipients?: string[]): Promise<void> {
    if (recipients && recipients.length > 0) {
      await this.callBoolean("SendHideManialinkPageToLogin", [recipients[0]]);
      return;
    }

    await this.callBoolean("SendHideManialinkPage");
  }

  public async callVote(xmlRpcRequest: string): Promise<void> {
    await this.callBoolean("CallVote", [xmlRpcRequest]);
  }

  public async callVoteEx(
    xmlRpcRequest: string,
    ratio = -1,
    timeout = 0,
    voters = 0
  ): Promise<void> {
    await this.callBoolean("CallVoteEx", [xmlRpcRequest, ratio, timeout, voters]);
  }

  public async setModeScriptSettings(settings: Record<string, XmlRpcValue>): Promise<void> {
    await this.callBoolean("SetModeScriptSettings", [settings]);
  }

  public async sendModeScriptCommands(commands: Record<string, XmlRpcValue>): Promise<void> {
    await this.callBoolean("SendModeScriptCommands", [commands]);
  }

  public async triggerModeScriptEventArray(name: string, values: XmlRpcValue[]): Promise<void> {
    await this.callBoolean("TriggerModeScriptEventArray", [name, values]);
  }

  public async modeSupportsPause(): Promise<boolean> {
    const scriptInfo = await this.getModeScriptInfo();
    const commands = scriptInfo.commandDescs ?? [];
    return commands.some((command) => {
      return command.name === "Command_SetPause" || command.name === "Command_ForceWarmUp";
    });
  }

  public async setPauseActive(active: boolean): Promise<void> {
    const responseId = `pause-${Date.now()}`;

    try {
      await this.triggerModeScriptEventArray("Maniaplanet.Pause.SetActive", [
        active ? "True" : "False",
        responseId
      ]);
      return;
    } catch (error) {
      this.logger.debug({ error, active }, "Pause.SetActive failed, trying command fallback");
    }

    if (active) {
      await this.tryCommandFallback({
        Command_SetPause: true,
        Command_ForceWarmUp: true
      });
      return;
    }

    await this.tryCommandFallback({
      Command_SetPause: false
    });
  }

  public drainCallbacks(): XmlRpcCallMessage[] {
    return this.transport.drainCallbacks();
  }

  public close(): void {
    this.transport.close();
  }

  private async callBoolean(method: string, params: XmlRpcValue[] = []): Promise<void> {
    const result = await this.transport.call(method, params);
    if (result !== true) {
      this.logger.warn({ method, result }, "Dedicated server returned a non-true value");
    }
  }

  private async callStruct(method: string): Promise<Record<string, XmlRpcValue>> {
    return this.callStructWithParams(method, []);
  }

  private async callStructWithParams(
    method: string,
    params: XmlRpcValue[]
  ): Promise<Record<string, XmlRpcValue>> {
    const result = await this.transport.call(method, params);
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw new Error(`${method} returned an unexpected payload`);
    }
    return result as Record<string, XmlRpcValue>;
  }

  private async tryCommandFallback(commands: Record<string, XmlRpcValue>): Promise<void> {
    try {
      await this.sendModeScriptCommands(commands);
    } catch (error) {
      this.logger.warn({ error, commands }, "Mode script command fallback failed");
      throw error;
    }
  }
}

function readString(struct: Record<string, XmlRpcValue>, key: string): string | undefined {
  const value = readValue(struct, key);
  return typeof value === "string" ? value : undefined;
}

function readNumber(struct: Record<string, XmlRpcValue>, key: string): number | undefined {
  const value = readValue(struct, key);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(struct: Record<string, XmlRpcValue>, key: string): boolean | undefined {
  const value = readValue(struct, key);
  return typeof value === "boolean" ? value : undefined;
}

function readStructArray(
  struct: Record<string, XmlRpcValue>,
  key: string
): Record<string, XmlRpcValue>[] {
  const value = readValue(struct, key);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is Record<string, XmlRpcValue> => {
    return typeof item === "object" && item !== null && !Array.isArray(item);
  });
}

function readValue(struct: Record<string, XmlRpcValue>, key: string): XmlRpcValue | undefined {
  for (const candidate of keyCandidates(key)) {
    if (candidate in struct) {
      return struct[candidate];
    }
  }
  return undefined;
}

function keyCandidates(key: string): string[] {
  const pascalCase = key.charAt(0).toUpperCase() + key.slice(1);
  return [key, pascalCase];
}
