import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import { CallbackBus } from "./callbacks.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { ControllerPlugin } from "../plugins/plugin.js";
import { DedicatedClient } from "../transport/dedicated-client.js";
import { UIService } from "../ui/ui-service.js";
import type { DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";
import { AdminHttpServer } from "../admin-http/server.js";
import { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";

const LEGACY_WIDGET_IDS = [
  "maniacontrol-ts.elite.state",
  "maniacontrol-ts.maniaexchange.sidebar",
  "maniacontrol-ts.maniaexchange.panel"
] as const;

export class ControllerApp {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly callbacks = new CallbackBus();
  private readonly pluginRegistry = new PluginRegistry();
  private readonly client: DedicatedClient;
  private readonly ui: UIService;
  private readonly startedAt = new Date().toISOString();

  private plugins: ControllerPlugin[] = [];
  private keepRunning = true;
  private version?: DedicatedVersion;
  private systemInfo?: DedicatedSystemInfo;
  private adminServer?: AdminHttpServer;

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
    this.version = version;
    this.systemInfo = systemInfo;

    this.logger.info(
      {
        serverLogin: systemInfo.serverLogin,
        titleId: systemInfo.titleId,
        build: version.build,
        apiVersion: version.apiVersion
      },
      "Dedicated server session established"
    );

    await this.clearLegacyUi();

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

    if (this.config.admin?.enabled) {
      this.adminServer = new AdminHttpServer({
        config: this.config.admin,
        logger: this.logger,
        callbacks: this.callbacks,
        client: this.client,
        getSnapshot: () => ({
          startedAt: this.startedAt,
          version: this.version,
          systemInfo: this.systemInfo
        }),
        getElitePlugin: () => this.plugins.find((plugin) => plugin instanceof ShootManiaElitePlugin) as ShootManiaElitePlugin | undefined,
        getManiaExchangePlugin: () => this.plugins.find((plugin) => plugin instanceof ManiaExchangePlugin) as ManiaExchangePlugin | undefined
      });
      await this.adminServer.start();
    }

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

    if (this.adminServer) {
      await this.adminServer.stop();
      this.adminServer = undefined;
    }

    for (const plugin of [...this.plugins].reverse()) {
      if (plugin.stop) {
        await plugin.stop();
      }
    }

    await this.clearLegacyUi();
    this.client.close();
  }

  private async clearLegacyUi(): Promise<void> {
    await this.ui.hideWidget();
    for (const widgetId of LEGACY_WIDGET_IDS) {
      await this.ui.clearWidget(widgetId);
    }
    this.logger.info({ widgetIds: LEGACY_WIDGET_IDS }, "Cleared legacy in-game widgets");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
