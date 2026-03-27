import { describe, expect, it, vi } from "vitest";

import { handleAdminReadRoute } from "./read-routes.js";
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
      getMapList: vi.fn(async () => []),
    },
    sseHub: {
      getClientCount: vi.fn(() => 0),
      addClient: vi.fn(),
      publish: vi.fn((event: string, payload: unknown) => {
        published.push({ event, payload });
      }),
    },
    auditLog: {
      readRecent: vi.fn(async () => []),
    },
    activityLog: {
      readRecent: vi.fn(async () => []),
    },
    localRecordsStore: {
      getCurrentMapRecords: vi.fn(),
      listMaps: vi.fn(async () => []),
    },
    getSnapshot: vi.fn(() => ({
      startedAt: "2026-03-27T10:00:00.000Z",
    })),
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

describe("handleAdminReadRoute", () => {
  it("clamps map list pagination before calling the dedicated client", async () => {
    const getMapList = vi.fn(async () => [{ fileName: "Map.Gbx" }]);
    const { context, writes } = createContext({
      client: {
        getMapList,
      },
    });

    const handled = await handleAdminReadRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/maps?limit=999&offset=-4"),
      createAuth(["read"])
    );

    expect(handled).toBe(true);
    expect(getMapList).toHaveBeenCalledWith(200, 0);
    expect(writes).toEqual([{
      statusCode: 200,
      body: {
        offset: 0,
        limit: 200,
        count: 1,
        maps: [{ fileName: "Map.Gbx" }],
      },
      audit: undefined,
    }]);
  });

  it("passes audit activity filters through to the activity log", async () => {
    const readRecent = vi.fn(async () => [{ category: "players", login: "Alice" }]);
    const { context, writes } = createContext({
      activityLog: {
        readRecent,
      },
    });

    const handled = await handleAdminReadRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/admin/activity?limit=999&category=players&login=Alice"),
      createAuth(["audit.read"])
    );

    expect(handled).toBe(true);
    expect(readRecent).toHaveBeenCalledWith({
      limit: 500,
      category: "players",
      login: "Alice",
    });
    expect(writes).toEqual([{
      statusCode: 200,
      body: {
        count: 1,
        entries: [{ category: "players", login: "Alice" }],
      },
      audit: undefined,
    }]);
  });

  it("rejects sanctions endpoints without the dedicated sanctions scope", async () => {
    const { context, forbiddenScopes, writes } = createContext();

    const handled = await handleAdminReadRoute(
      context,
      {} as never,
      {} as never,
      new URL("http://127.0.0.1/server/players/banlist"),
      createAuth(["read"])
    );

    expect(handled).toBe(true);
    expect(forbiddenScopes).toEqual(["players.sanctions.read"]);
    expect(writes).toEqual([]);
  });
});
