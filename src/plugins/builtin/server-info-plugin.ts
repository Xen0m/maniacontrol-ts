import type { ControllerPlugin, PluginContext } from "../plugin.js";

export class ServerInfoPlugin implements ControllerPlugin {
  public readonly id = "server-info";

  private context?: PluginContext;

  public async setup(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info(
      {
        titleId: context.systemInfo.titleId,
        serverLogin: context.systemInfo.serverLogin,
        version: context.version.version,
        build: context.version.build,
        apiVersion: context.version.apiVersion
      },
      "Connected to dedicated server"
    );

    context.callbacks.on("callback", (event) => {
      context.logger.debug({ callback: event.method }, "Dedicated callback received");
    });
  }

  public async stop(): Promise<void> {
    this.context?.logger.info("Stopping server-info plugin");
  }
}
