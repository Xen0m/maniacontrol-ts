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

export class PluginRegistry {
  private readonly pluginFactories: Map<string, () => ControllerPlugin>;
  private readonly externalPluginLoader: (modulePath: string) => Promise<ControllerPlugin>;

  public constructor(
    pluginFactories: Map<string, () => ControllerPlugin> = builtinPluginFactories,
    externalPluginLoader: (modulePath: string) => Promise<ControllerPlugin> = loadExternalPlugin
  ) {
    this.pluginFactories = pluginFactories;
    this.externalPluginLoader = externalPluginLoader;
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
        await plugin.setup({
          ...runtimeContext,
          logger: pluginLogger,
          pluginConfig
        });

        if (plugin.start) {
          await plugin.start();
        }

        plugins.push(plugin);
      } catch (error) {
        pluginLogger.error({ error }, "Plugin failed during setup/start and will be skipped");
        if (plugin.stop) {
          try {
            await plugin.stop();
          } catch (stopError) {
            pluginLogger.warn({ error: stopError }, "Plugin cleanup failed after setup/start error");
          }
        }
      }
    }

    return plugins;
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
}
