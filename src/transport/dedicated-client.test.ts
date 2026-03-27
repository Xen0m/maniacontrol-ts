import { describe, expect, it, vi } from "vitest";

import { DedicatedClient } from "./dedicated-client.js";

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  };
  return logger;
}

function createClient(call: (method: string, params?: unknown[]) => Promise<unknown>) {
  const logger = createLogger();
  const client = new DedicatedClient("127.0.0.1", 5000, 30_000, logger as never);
  (client as unknown as { transport: { call: typeof call } }).transport = { call };
  return { client, logger };
}

describe("DedicatedClient", () => {
  it("falls back to GetCurrentChallengeInfo when GetCurrentMapInfo fails", async () => {
    const { client, logger } = createClient(async (method) => {
      if (method === "GetCurrentMapInfo") {
        throw new Error("unsupported");
      }
      if (method === "GetCurrentChallengeInfo") {
        return {
          name: "CastleCrasher",
          uId: "map-123",
          fileName: "Maps/CastleCrasher.Map.Gbx",
          author: "nadeo"
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getCurrentMapInfo()).resolves.toEqual({
      name: "CastleCrasher",
      uId: "map-123",
      fileName: "Maps/CastleCrasher.Map.Gbx",
      author: "nadeo",
      environment: undefined,
      mapType: undefined,
      mapStyle: undefined
    });
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it("normalizes legacy-cased ban list entries", async () => {
    const { client } = createClient(async (method) => {
      if (method === "GetBanList") {
        return [
          {
            Login: "player-a",
            ClientName: "$fffPlayer A",
            IPAddress: "127.0.0.1"
          },
          {
            login: "player-b",
            nickName: "$f00Player B",
            ipAddress: "127.0.0.2"
          }
        ];
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.getBanList(10, 0)).resolves.toEqual([
      {
        login: "player-a",
        nickName: "$fffPlayer A",
        ipAddress: "127.0.0.1"
      },
      {
        login: "player-b",
        nickName: "$f00Player B",
        ipAddress: "127.0.0.2"
      }
    ]);
  });

  it("detects pause support from mode script commands", async () => {
    const { client } = createClient(async (method) => {
      if (method === "GetModeScriptInfo") {
        return {
          commandDescs: [
            { name: "Command_Foo" },
            { name: "Command_SetPause" }
          ]
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(client.modeSupportsPause()).resolves.toBe(true);
  });

  it("falls back to mode script commands when pause event RPC is unavailable", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const { client, logger } = createClient(async (method, params = []) => {
      calls.push({ method, params });
      if (method === "TriggerModeScriptEventArray") {
        throw new Error("missing callback");
      }
      if (method === "SendModeScriptCommands") {
        return true;
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await client.setPauseActive(true);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("TriggerModeScriptEventArray");
    expect(calls[1]).toEqual({
      method: "SendModeScriptCommands",
      params: [
        {
          Command_SetPause: true,
          Command_ForceWarmUp: true
        }
      ]
    });
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
