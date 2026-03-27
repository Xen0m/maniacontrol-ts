import { describe, expect, it, vi } from "vitest";

import { PluginRegistry } from "./registry.js";
import type { ControllerPlugin } from "./plugin.js";

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

describe("PluginRegistry", () => {
  it("skips plugins that fail during startup and keeps healthy ones", async () => {
    const setupCalls: string[] = [];
    const stopCalls: string[] = [];

    const healthyPlugin: ControllerPlugin = {
      id: "healthy",
      async setup() {
        setupCalls.push("healthy");
      }
    };

    const failingPlugin: ControllerPlugin = {
      id: "failing",
      async setup() {
        setupCalls.push("failing");
      },
      async start() {
        throw new Error("boom");
      },
      async stop() {
        stopCalls.push("failing");
      }
    };

    const registry = new PluginRegistry(new Map([
      ["healthy", () => healthyPlugin],
      ["failing", () => failingPlugin]
    ]));
    const logger = createLogger();

    const plugins = await registry.loadPlugins(
      {
        logger: logger as never,
        config: {} as never,
        callbacks: {} as never,
        client: {} as never,
        ui: {} as never,
        version: {},
        systemInfo: {}
      },
      [
        { id: "healthy", enabled: true },
        { id: "failing", enabled: true }
      ]
    );

    expect(plugins).toEqual([healthyPlugin]);
    expect(setupCalls).toEqual(["healthy", "failing"]);
    expect(stopCalls).toEqual(["failing"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
