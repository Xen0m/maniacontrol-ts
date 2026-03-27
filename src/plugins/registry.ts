import type { PluginConfig } from "../config/schema.js";
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

  public constructor(pluginFactories: Map<string, () => ControllerPlugin> = builtinPluginFactories) {
    this.pluginFactories = pluginFactories;
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

      const factory = this.pluginFactories.get(pluginConfig.id);
      if (!factory) {
        runtimeContext.logger.warn({ pluginId: pluginConfig.id }, "Unknown plugin id");
        continue;
      }

      const plugin = factory();
      const pluginLogger = runtimeContext.logger.child({ pluginId: plugin.id });

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
}
