import { describe, expect, it, vi } from "vitest";

import type { PluginConfig } from "../config/schema.js";
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
  function createRuntimeContext(logger = createLogger()) {
    return {
      logger: logger as never,
      config: {} as never,
      callbacks: {} as never,
      client: {} as never,
      ui: {} as never,
      version: {},
      systemInfo: {}
    };
  }

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
      createRuntimeContext(logger),
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

  it("loads external plugins from the configured module path", async () => {
    const setupCalls: string[] = [];
    const externalPlugin: ControllerPlugin = {
      id: "external-sample",
      async setup() {
        setupCalls.push("external");
      }
    };
    const externalPluginLoader = vi.fn(async () => externalPlugin);
    const registry = new PluginRegistry(new Map(), externalPluginLoader);
    const logger = createLogger();

    const plugins = await registry.loadPlugins(
      createRuntimeContext(logger),
      [
        { id: "external-sample", module: "./plugins/sample-plugin.mjs", enabled: true } satisfies PluginConfig
      ]
    );

    expect(plugins).toEqual([externalPlugin]);
    expect(setupCalls).toEqual(["external"]);
    expect(externalPluginLoader).toHaveBeenCalledWith("./plugins/sample-plugin.mjs");
  });

  it("skips broken external plugins and keeps loading remaining entries", async () => {
    const healthyPlugin: ControllerPlugin = {
      id: "healthy",
      async setup() {}
    };
    const externalPluginLoader = vi.fn(async (modulePath: string) => {
      if (modulePath.includes("broken")) {
        throw new Error("bad module");
      }
      return healthyPlugin;
    });
    const registry = new PluginRegistry(new Map(), externalPluginLoader);
    const logger = createLogger();

    const plugins = await registry.loadPlugins(
      createRuntimeContext(logger),
      [
        { id: "broken-plugin", module: "./plugins/broken-plugin.mjs", enabled: true } satisfies PluginConfig,
        { id: "healthy", module: "./plugins/healthy-plugin.mjs", enabled: true } satisfies PluginConfig
      ]
    );

    expect(plugins).toEqual([healthyPlugin]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
