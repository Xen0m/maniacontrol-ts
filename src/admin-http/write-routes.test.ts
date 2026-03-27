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
