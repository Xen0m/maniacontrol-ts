import { describe, expect, it, vi } from "vitest";

import { handleAdminWriteRoute } from "./write-routes.js";
import type { ResolvedAdminAuth } from "./types.js";

function createAuth(scopes: string[]): ResolvedAdminAuth {
  return {
    id: "test-token",
    label: "Test token",
    role: "operator",
    scopes,
  };
}

function createContext(overrides: Record<string, unknown> = {}) {
  const writes: Array<{ statusCode: number; body: unknown; audit?: unknown }> = [];
  const forbiddenScopes: string[] = [];
  const published: Array<{ event: string; payload: unknown }> = [];

  const context = {
    config: {
      enabled: true,
      host: "127.0.0.1",
      port: 3001,
      serverFilesRoot: "/srv/maniaplanet",
      token: "secret",
      principals: [],
      modePresets: [],
      auditPath: "./audit.jsonl",
      activityPath: "./activity.jsonl",
      localRecordsPath: "./records.json",
      chatLoggingEnabled: false,
    },
    client: {
      applyModePreset: vi.fn(),
      callVote: vi.fn(async () => undefined),
      callVoteEx: vi.fn(async () => undefined),
      getModeScriptInfo: vi.fn(async () => ({ name: "Mode" })),
      getModeScriptSettings: vi.fn(async () => ({ setting: true })),
      loadMatchSettings: vi.fn(async () => undefined),
      restartMap: vi.fn(async () => undefined),
      sendModeScriptCommands: vi.fn(async () => undefined),
      setModeScriptSettings: vi.fn(async () => undefined),
      setScriptName: vi.fn(async () => undefined),
    },
    sseHub: {
      publish: vi.fn((event: string, payload: unknown) => {
        published.push({ event, payload });
      }),
    },
    auditLog: {},
    activityLog: {},
    localRecordsStore: {},
    getSnapshot: vi.fn(),
    getElitePlugin: vi.fn(() => undefined),
    getManiaExchangePlugin: vi.fn(() => undefined),
    getModeCatalog: vi.fn(async () => []),
    installModePresetAssets: vi.fn(async () => ({
      canInstall: false,
      installableAssetCount: 0,
      assets: [],
      installedAssetCount: 0,
      installedAssets: [],
    })),
    readJsonBody: vi.fn(async () => ({})),
    writeJson: vi.fn(async (_response, statusCode: number, body: unknown, audit?: unknown) => {
      writes.push({ statusCode, body, audit });
    }),
    writeForbidden: vi.fn(async (_response, _auth, requiredScope: string) => {
      forbiddenScopes.push(requiredScope);
    }),
    ...overrides,
  };

  return { context: context as never, writes, forbiddenScopes, published };
}

describe("handleAdminWriteRoute", () => {
  it("rejects mode presets whose required assets are missing", async () => {
    const loadMatchSettings = vi.fn();
    const setScriptName = vi.fn();
    const installModePresetAssets = vi.fn();
    const { context, writes } = createContext({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 3001,
        serverFilesRoot: "/srv/maniaplanet",
        token: "secret",
        principals: [],
        modePresets: [{
          id: "elite",
          label: "Elite",
          scriptName: "ShootMania/Elite.Script.txt",
        }],
        auditPath: "./audit.jsonl",
        activityPath: "./activity.jsonl",
        localRecordsPath: "./records.json",
        chatLoggingEnabled: false,
      },
      client: {
        loadMatchSettings,
        setScriptName,
      },
      installModePresetAssets,
      getModeCatalog: vi.fn(async () => [{
        id: "elite",
        label: "Elite",
        scriptName: "ShootMania/Elite.Script.txt",
        status: {
          kind: "missing",
          canApply: false,
          checksAvailable: true,
          checkedAssetCount: 1,
          missingAssetCount: 1,
          rootPath: "/srv/maniaplanet",
          rootExists: true,
          assets: [],
        },
      }]),
      readJsonBody: vi.fn(async () => ({ presetId: "elite" })),
    });

    const handled = await handleAdminWriteRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/mode/apply-preset"),
      createAuth(["mode.write"])
    );

    expect(handled).toBe(true);
    expect(loadMatchSettings).not.toHaveBeenCalled();
    expect(setScriptName).not.toHaveBeenCalled();
    expect(installModePresetAssets).not.toHaveBeenCalled();
    expect(writes).toEqual([{
      statusCode: 409,
      body: {
        error: "preset assets missing",
        presetId: "elite",
        status: {
          kind: "missing",
          canApply: false,
          checksAvailable: true,
          checkedAssetCount: 1,
          missingAssetCount: 1,
          rootPath: "/srv/maniaplanet",
          rootExists: true,
          assets: [],
        },
      },
      audit: undefined,
    }]);
  });

  it("installs missing preset assets before applying an installable preset", async () => {
    const loadMatchSettings = vi.fn(async () => undefined);
    const setScriptName = vi.fn(async () => undefined);
    const restartMap = vi.fn(async () => undefined);
    const installModePresetAssets = vi.fn(async () => ({
      canInstall: true,
      installableAssetCount: 1,
      installedAssetCount: 1,
      assets: [],
      installedAssets: [{
        kind: "script",
        label: "Mode script",
        reference: "ShootMania/InstaDM.Script.txt",
        relativePath: "GameData/Scripts/Modes/ShootMania/InstaDM.Script.txt",
        absolutePath: "/srv/maniaplanet/GameData/Scripts/Modes/ShootMania/InstaDM.Script.txt",
        exists: true,
        sourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
        sourceAbsolutePath: "/repo/vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
        sourceExists: true,
      }],
    }));
    const { context, writes, published } = createContext({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 3001,
        serverFilesRoot: "/srv/maniaplanet",
        token: "secret",
        principals: [],
        modePresets: [{
          id: "instadm",
          label: "InstaDM",
          scriptName: "ShootMania/InstaDM.Script.txt",
          scriptSourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
          modeSettings: {
            S_WeaponNumber: 2,
          },
          restartAfterApply: true,
        }],
        auditPath: "./audit.jsonl",
        activityPath: "./activity.jsonl",
        localRecordsPath: "./records.json",
        chatLoggingEnabled: false,
      },
      client: {
        getModeScriptInfo: vi.fn(async () => ({ name: "InstaDM" })),
        getModeScriptSettings: vi.fn(async () => ({ S_WeaponNumber: 2 })),
        loadMatchSettings,
        restartMap,
        setModeScriptSettings: vi.fn(async () => undefined),
        setScriptName,
      },
      installModePresetAssets,
      getModeCatalog: vi.fn(async () => [{
        id: "instadm",
        label: "InstaDM",
        scriptName: "ShootMania/InstaDM.Script.txt",
        scriptSourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
        status: {
          kind: "missing",
          canApply: true,
          canInstall: true,
          checksAvailable: true,
          checkedAssetCount: 1,
          missingAssetCount: 1,
          installableAssetCount: 1,
          rootPath: "/srv/maniaplanet",
          rootExists: true,
          assets: [],
        },
      }]),
      readJsonBody: vi.fn(async () => ({ presetId: "instadm" })),
    });

    const handled = await handleAdminWriteRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/mode/apply-preset"),
      createAuth(["mode.write"])
    );

    expect(handled).toBe(true);
    expect(installModePresetAssets).toHaveBeenCalledWith("instadm");
    expect(setScriptName).toHaveBeenCalledWith("ShootMania/InstaDM.Script.txt");
    expect(restartMap).toHaveBeenCalled();
    expect(published).toEqual([{
      event: "server.modePresetApplied",
      payload: {
        presetId: "instadm",
        label: "InstaDM",
        scriptName: "ShootMania/InstaDM.Script.txt",
        matchSettings: undefined,
        restartAfterApply: true,
      },
    }]);
    expect(writes).toEqual([{
      statusCode: 200,
      body: {
        ok: true,
        preset: {
          id: "instadm",
          label: "InstaDM",
          description: undefined,
          scriptName: "ShootMania/InstaDM.Script.txt",
          scriptSourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
          matchSettings: undefined,
          matchSettingsSourcePath: undefined,
          restartAfterApply: true,
          status: {
            kind: "missing",
            canApply: true,
            canInstall: true,
            checksAvailable: true,
            checkedAssetCount: 1,
            missingAssetCount: 1,
            installableAssetCount: 1,
            rootPath: "/srv/maniaplanet",
            rootExists: true,
            assets: [],
          },
        },
        install: {
          installedAssetCount: 1,
          installedAssets: [{
            kind: "script",
            relativePath: "GameData/Scripts/Modes/ShootMania/InstaDM.Script.txt",
            sourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
          }],
        },
        modeScriptInfo: { name: "InstaDM" },
        modeScriptSettings: { S_WeaponNumber: 2 },
      },
      audit: {
        action: "server.mode-preset.apply",
        success: true,
        detail: {
          presetId: "instadm",
          label: "InstaDM",
          scriptName: "ShootMania/InstaDM.Script.txt",
          scriptSourcePath: "vendor/maniaplanet-scripts/Modes/ShootMania/InstaDM.Script.txt",
          matchSettings: undefined,
          matchSettingsSourcePath: undefined,
          installedAssetCount: 1,
          restartAfterApply: true,
        },
      },
    }]);
  });

  it("uses XML-RPC vote payloads and callVoteEx when vote options are provided", async () => {
    const callVote = vi.fn(async () => undefined);
    const callVoteEx = vi.fn(async () => undefined);
    const { context, writes, published } = createContext({
      client: {
        callVote,
        callVoteEx,
      },
      readJsonBody: vi.fn(async () => ({
        command: "ChatSendServerMessage <go> & 'now'",
        ratio: 0.6,
        timeout: 15,
        voters: 8,
      })),
    });

    const handled = await handleAdminWriteRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/votes/call"),
      createAuth(["votes.write"])
    );

    expect(handled).toBe(true);
    expect(callVote).not.toHaveBeenCalled();
    expect(callVoteEx).toHaveBeenCalledWith(
      "<?xml version=\"1.0\"?><methodCall><methodName>ChatSendServerMessage &lt;go&gt; &amp; &apos;now&apos;</methodName><params></params></methodCall>",
      0.6,
      15,
      8
    );
    expect(published).toEqual([{
      event: "server.voteCalled",
      payload: {
        command: "ChatSendServerMessage <go> & 'now'",
        ratio: 0.6,
        timeout: 15,
        voters: 8,
      },
    }]);
    expect(writes).toEqual([{
      statusCode: 200,
      body: {
        ok: true,
        command: "ChatSendServerMessage <go> & 'now'",
        ratio: 0.6,
        timeout: 15,
        voters: 8,
      },
      audit: {
        action: "server.votes.call",
        success: true,
        detail: {
          command: "ChatSendServerMessage <go> & 'now'",
          ratio: 0.6,
          timeout: 15,
          voters: 8,
        },
      },
    }]);
  });

  it("forbids map write endpoints when the token lacks maps.write", async () => {
    const { context, forbiddenScopes, writes } = createContext();

    const handled = await handleAdminWriteRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/maps/next"),
      createAuth(["read"])
    );

    expect(handled).toBe(true);
    expect(forbiddenScopes).toEqual(["maps.write"]);
    expect(writes).toEqual([]);
  });
});
