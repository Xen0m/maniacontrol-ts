import type { PluginConfig } from "../config/schema.js";
import type { ControllerPlugin, ControllerRuntimeContext } from "./plugin.js";
import { ServerInfoPlugin } from "./builtin/server-info-plugin.js";
import { ShootManiaElitePlugin } from "./builtin/shootmania-elite-plugin.js";

const builtinPluginFactories = new Map<string, () => ControllerPlugin>([
  ["server-info", () => new ServerInfoPlugin()],
  ["shootmania-elite", () => new ShootManiaElitePlugin()]
]);

export class PluginRegistry {
  public async loadPlugins(
    runtimeContext: ControllerRuntimeContext,
    pluginConfigs: PluginConfig[]
  ): Promise<ControllerPlugin[]> {
    const plugins: ControllerPlugin[] = [];

    for (const pluginConfig of pluginConfigs) {
      if (!pluginConfig.enabled) {
        continue;
      }

      const factory = builtinPluginFactories.get(pluginConfig.id);
      if (!factory) {
        runtimeContext.logger.warn({ pluginId: pluginConfig.id }, "Unknown plugin id");
        continue;
      }

      const plugin = factory();
      const pluginLogger = runtimeContext.logger.child({ pluginId: plugin.id });
      await plugin.setup({
        ...runtimeContext,
        logger: pluginLogger,
        pluginConfig
      });

      if (plugin.start) {
        await plugin.start();
      }

      plugins.push(plugin);
    }

    return plugins;
  }
}
