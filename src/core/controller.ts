import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import { CallbackBus } from "./callbacks.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { ControllerPlugin } from "../plugins/plugin.js";
import { DedicatedClient } from "../transport/dedicated-client.js";
import { UIService } from "../ui/ui-service.js";

export class ControllerApp {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly callbacks = new CallbackBus();
  private readonly pluginRegistry = new PluginRegistry();
  private readonly client: DedicatedClient;
  private readonly ui: UIService;

  private plugins: ControllerPlugin[] = [];
  private keepRunning = true;

  public constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: "controller" });
    this.client = new DedicatedClient(
      config.server.host,
      config.server.port,
      30_000,
      this.logger
    );
    this.ui = new UIService(this.client, this.logger);
  }

  public async run(): Promise<void> {
    await this.client.connect(
      this.config.server.user,
      this.config.server.password,
      this.config.controller.apiVersion
    );

    if (this.config.controller.enableCallbacks) {
      await this.client.enableCallbacks(true);
    }

    const version = await this.client.getVersion();
    const systemInfo = await this.client.getSystemInfo();

    this.logger.info(
      {
        serverLogin: systemInfo.serverLogin,
        titleId: systemInfo.titleId,
        build: version.build,
        apiVersion: version.apiVersion
      },
      "Dedicated server session established"
    );

    this.plugins = await this.pluginRegistry.loadPlugins(
      {
        logger: this.logger,
        config: this.config,
        callbacks: this.callbacks,
        client: this.client,
        ui: this.ui,
        version,
        systemInfo
      },
      this.config.plugins
    );

    for (;;) {
      if (!this.keepRunning) {
        break;
      }

      const callbacks = this.client.drainCallbacks();
      for (const callback of callbacks) {
        this.callbacks.dispatch(callback);
      }

      await delay(this.config.controller.pollIntervalMs);
    }
  }

  public async shutdown(): Promise<void> {
    this.keepRunning = false;

    for (const plugin of [...this.plugins].reverse()) {
      if (plugin.stop) {
        await plugin.stop();
      }
    }

    this.client.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
