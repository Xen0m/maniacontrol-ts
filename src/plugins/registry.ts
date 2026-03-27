import type { PluginConfig } from "../config/schema.js";
import { loadExternalPlugin } from "./external-loader.js";
import type { ControllerPlugin, ControllerRuntimeContext } from "./plugin.js";
import { ManiaExchangePlugin } from "./builtin/maniaexchange-plugin.js";
import { ServerInfoPlugin } from "./builtin/server-info-plugin.js";
import { ShootManiaElitePlugin } from "./builtin/shootmania-elite-plugin.js";

const builtinPluginFactories = new Map<string, () => ControllerPlugin>([
  ["server-info", () => new ServerInfoPlugin()],
  ["shootmania-elite", () => new ShootManiaElitePlugin()],
  ["maniaexchange", () => new ManiaExchangePlugin()]
]);

const DEFAULT_PLUGIN_LIFECYCLE_TIMEOUT_MS = 10_000;

export class PluginRegistry {
  private readonly pluginFactories: Map<string, () => ControllerPlugin>;
  private readonly externalPluginLoader: (modulePath: string) => Promise<ControllerPlugin>;
  private readonly lifecycleTimeoutMs: number;

  public constructor(
    pluginFactories: Map<string, () => ControllerPlugin> = builtinPluginFactories,
    externalPluginLoader: (modulePath: string) => Promise<ControllerPlugin> = loadExternalPlugin,
    lifecycleTimeoutMs = DEFAULT_PLUGIN_LIFECYCLE_TIMEOUT_MS
  ) {
    this.pluginFactories = pluginFactories;
    this.externalPluginLoader = externalPluginLoader;
    this.lifecycleTimeoutMs = lifecycleTimeoutMs;
  }

  public async loadPlugins(
    runtimeContext: ControllerRuntimeContext,
    pluginConfigs: PluginConfig[]
  ): Promise<ControllerPlugin[]> {
    const plugins: ControllerPlugin[] = [];

    for (const pluginConfig of pluginConfigs) {
      if (!pluginConfig.enabled) {
        continue;
      }

      const pluginLogger = runtimeContext.logger.child({ pluginId: pluginConfig.id });
      const plugin = await this.createPlugin(pluginConfig, pluginLogger);
      if (!plugin) {
        continue;
      }

      try {
        await this.runLifecycleStep(pluginLogger, plugin, "setup", () => plugin.setup({
          ...runtimeContext,
          logger: pluginLogger,
          pluginConfig
        }));

        if (plugin.start) {
          await this.runLifecycleStep(pluginLogger, plugin, "start", () => plugin.start?.());
        }

        plugins.push(plugin);
      } catch (error) {
        pluginLogger.error({ error }, "Plugin failed during setup/start and will be skipped");
        await this.stopPlugin(plugin, pluginLogger, "Plugin cleanup failed after setup/start error");
      }
    }

    return plugins;
  }

  public async stopPlugins(
    logger: ControllerRuntimeContext["logger"],
    plugins: ControllerPlugin[]
  ): Promise<void> {
    for (const plugin of [...plugins].reverse()) {
      const pluginLogger = logger.child({ pluginId: plugin.id });
      await this.stopPlugin(plugin, pluginLogger, "Plugin shutdown failed");
    }
  }

  private async createPlugin(
    pluginConfig: PluginConfig,
    logger: ControllerRuntimeContext["logger"]
  ): Promise<ControllerPlugin | null> {
    if (pluginConfig.module) {
      try {
        const plugin = await this.externalPluginLoader(pluginConfig.module);
        if (plugin.id !== pluginConfig.id) {
          logger.warn({
            configuredPluginId: pluginConfig.id,
            loadedPluginId: plugin.id,
            modulePath: pluginConfig.module
          }, "External plugin id does not match configured id");
        }
        return plugin;
      } catch (error) {
        logger.error({ error, modulePath: pluginConfig.module }, "External plugin failed to load");
        return null;
      }
    }

    const factory = this.pluginFactories.get(pluginConfig.id);
    if (!factory) {
      logger.warn({ pluginId: pluginConfig.id }, "Unknown plugin id");
      return null;
    }

    return factory();
  }

  private async stopPlugin(
    plugin: ControllerPlugin,
    logger: ControllerRuntimeContext["logger"],
    failureMessage: string
  ): Promise<void> {
    if (!plugin.stop) {
      return;
    }

    try {
      await this.runLifecycleStep(logger, plugin, "stop", () => plugin.stop?.());
    } catch (error) {
      logger.warn({ error, pluginId: plugin.id }, failureMessage);
    }
  }

  private async runLifecycleStep(
    logger: ControllerRuntimeContext["logger"],
    plugin: ControllerPlugin,
    phase: "setup" | "start" | "stop",
    operation: () => Promise<void> | void
  ): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Plugin ${phase} timed out after ${this.lifecycleTimeoutMs} ms`));
          }, this.lifecycleTimeoutMs);
          timeoutId.unref?.();
        })
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    logger.debug({ pluginId: plugin.id, phase }, "Plugin lifecycle step completed");
  }
}
