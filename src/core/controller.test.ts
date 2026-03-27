import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config/schema.js";
import { ControllerApp } from "./controller.js";

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  };
  return logger;
}

function createConfig(): AppConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 5000,
      user: "SuperAdmin",
      password: "secret"
    },
    controller: {
      apiVersion: "2013-04-16",
      scriptApiVersion: "2.5.0",
      enableCallbacks: true,
      pollIntervalMs: 1,
      logLevel: "info"
    },
    plugins: []
  };
}

describe("ControllerApp", () => {
  it("retries after a failed session bootstrap", async () => {
    const logger = createLogger();
    const pluginRegistry = {
      loadPlugins: vi.fn(async () => []),
      stopPlugins: vi.fn(async () => undefined)
    };

    let app: ControllerApp;
    let clientCount = 0;
    const clients: Array<{ close: ReturnType<typeof vi.fn> }> = [];

    const createClient = () => {
      clientCount += 1;
      if (clientCount === 1) {
        const first = {
          connect: vi.fn(async () => {
            throw new Error("connect failed");
          }),
          enableCallbacks: vi.fn(),
          getVersion: vi.fn(),
          getSystemInfo: vi.fn(),
          drainCallbacks: vi.fn(() => []),
          waitForDisconnect: vi.fn(async () => undefined),
          close: vi.fn()
        };
        clients.push(first);
        return first as never;
      }

      const second = {
        connect: vi.fn(async () => undefined),
        enableCallbacks: vi.fn(async () => undefined),
        getVersion: vi.fn(async () => ({ apiVersion: "2013-04-16" })),
        getSystemInfo: vi.fn(async () => ({ serverLogin: "server", titleId: "title" })),
        drainCallbacks: vi.fn(() => []),
        waitForDisconnect: vi.fn(() => new Promise<Error | undefined>(() => undefined)),
        close: vi.fn()
      };
      clients.push(second);
      return second as never;
    };

    const createUi = () => ({
      hideWidget: vi.fn(async () => undefined),
      clearWidget: vi.fn(async () => undefined)
    }) as never;

    const delays: number[] = [];
    const delay = vi.fn(async (ms: number) => {
      delays.push(ms);
      if (ms === 1 && clientCount >= 2) {
        await app.shutdown();
      }
    });

    app = new ControllerApp(createConfig(), logger as never, {
      pluginRegistry: pluginRegistry as never,
      createClient,
      createUi,
      delay,
      reconnectBaseDelayMs: 5,
      reconnectMaxDelayMs: 20
    });

    await app.run();

    expect(clientCount).toBe(2);
    expect(delays).toContain(5);
    expect(pluginRegistry.loadPlugins).toHaveBeenCalledTimes(1);
    expect(pluginRegistry.stopPlugins).toHaveBeenCalled();
    expect(clients[0]?.close).toHaveBeenCalledTimes(1);
    expect(clients[1]?.close).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
