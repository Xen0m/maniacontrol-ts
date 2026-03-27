import type { Logger } from "pino";

import type { AppConfig } from "../config/schema.js";
import { CallbackBus } from "./callbacks.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { ControllerPlugin } from "../plugins/plugin.js";
import { DedicatedClient } from "../transport/dedicated-client.js";
import type { DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";
import { UIService } from "../ui/ui-service.js";
import { AdminHttpServer } from "../admin-http/server.js";
import { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";

const LEGACY_WIDGET_IDS = [
  "maniacontrol-ts.elite.state",
  "maniacontrol-ts.maniaexchange.sidebar",
  "maniacontrol-ts.maniaexchange.panel"
] as const;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

interface ControllerAppDependencies {
  pluginRegistry?: PluginRegistry;
  createCallbacks?: () => CallbackBus;
  createClient?: (logger: Logger) => DedicatedClient;
  createUi?: (client: DedicatedClient, logger: Logger) => UIService;
  createAdminServer?: (options: ConstructorParameters<typeof AdminHttpServer>[0]) => AdminHttpServer;
  delay?: (ms: number) => Promise<void>;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export class ControllerApp {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly pluginRegistry: PluginRegistry;
  private readonly createCallbacks: () => CallbackBus;
  private readonly createClient: (logger: Logger) => DedicatedClient;
  private readonly createUi: (client: DedicatedClient, logger: Logger) => UIService;
  private readonly createAdminServer: (options: ConstructorParameters<typeof AdminHttpServer>[0]) => AdminHttpServer;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly startedAt = new Date().toISOString();

  private callbacks?: CallbackBus;
  private client?: DedicatedClient;
  private ui?: UIService;
  private plugins: ControllerPlugin[] = [];
  private keepRunning = true;
  private version?: DedicatedVersion;
  private systemInfo?: DedicatedSystemInfo;
  private adminServer?: AdminHttpServer;

  public constructor(config: AppConfig, logger: Logger, dependencies: ControllerAppDependencies = {}) {
    this.config = config;
    this.logger = logger.child({ component: "controller" });
    this.pluginRegistry = dependencies.pluginRegistry ?? new PluginRegistry();
    this.createCallbacks = dependencies.createCallbacks ?? (() => new CallbackBus());
    this.createClient = dependencies.createClient ?? ((nextLogger) => new DedicatedClient(
      config.server.host,
      config.server.port,
      30_000,
      nextLogger
    ));
    this.createUi = dependencies.createUi ?? ((client, nextLogger) => new UIService(client, nextLogger));
    this.createAdminServer = dependencies.createAdminServer ?? ((options) => new AdminHttpServer(options));
    this.delay = dependencies.delay ?? delay;
    this.reconnectBaseDelayMs = dependencies.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = dependencies.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  }

  public async run(): Promise<void> {
    let reconnectDelayMs = this.reconnectBaseDelayMs;

    while (this.keepRunning) {
      let sessionError: unknown;

      try {
        sessionError = await this.runSession();
        reconnectDelayMs = this.reconnectBaseDelayMs;
      } catch (error) {
        sessionError = error;
        this.logger.error({ error }, "Dedicated session failed");
      } finally {
        await this.stopCurrentSession();
      }

      if (!this.keepRunning) {
        break;
      }

      this.logger.warn(
        {
          reconnectInMs: reconnectDelayMs,
          error: sessionError instanceof Error ? sessionError.message : sessionError
        },
        "Dedicated session ended; reconnecting"
      );
      await this.delay(reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, this.reconnectMaxDelayMs);
    }
  }

  public async shutdown(): Promise<void> {
    this.keepRunning = false;
    await this.stopCurrentSession();
  }

  private async runSession(): Promise<Error | undefined> {
    const callbacks = this.createCallbacks();
    const client = this.createClient(this.logger);
    const ui = this.createUi(client, this.logger);

    this.callbacks = callbacks;
    this.client = client;
    this.ui = ui;
    this.plugins = [];
    this.version = undefined;
    this.systemInfo = undefined;

    await client.connect(
      this.config.server.user,
      this.config.server.password,
      this.config.controller.apiVersion
    );

    if (this.config.controller.enableCallbacks) {
      await client.enableCallbacks(true);
    }

    const version = await client.getVersion();
    const systemInfo = await client.getSystemInfo();
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

    await this.tryClearLegacyUi("startup");

    this.plugins = await this.pluginRegistry.loadPlugins(
      {
        logger: this.logger,
        config: this.config,
        callbacks,
        client,
        ui,
        version,
        systemInfo
      },
      this.config.plugins
    );

    if (this.config.admin?.enabled) {
      this.adminServer = this.createAdminServer({
        config: this.config.admin,
        logger: this.logger,
        callbacks,
        client,
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

    return this.pollUntilDisconnect(client, callbacks);
  }

  private async pollUntilDisconnect(client: DedicatedClient, callbacks: CallbackBus): Promise<Error | undefined> {
    const disconnectPromise = client.waitForDisconnect().then((error) => ({
      disconnected: true,
      error
    }));

    while (this.keepRunning) {
      const result = await Promise.race([
        disconnectPromise,
        this.delay(this.config.controller.pollIntervalMs).then(() => ({
          disconnected: false as const,
          error: undefined
        }))
      ]);

      this.dispatchCallbacks(client, callbacks);

      if (result.disconnected) {
        if (result.error) {
          this.logger.warn({ error: result.error }, "Dedicated connection lost");
        } else {
          this.logger.warn("Dedicated connection closed");
        }
        return result.error;
      }
    }

    return undefined;
  }

  private dispatchCallbacks(client: DedicatedClient, callbacks: CallbackBus): void {
    for (const callback of client.drainCallbacks()) {
      try {
        callbacks.dispatch(callback);
      } catch (error) {
        this.logger.error({ error, method: callback.method }, "Callback dispatch failed");
      }
    }
  }

  private async stopCurrentSession(): Promise<void> {
    if (this.adminServer) {
      try {
        await this.adminServer.stop();
      } catch (error) {
        this.logger.warn({ error }, "Failed to stop admin server cleanly");
      }
      this.adminServer = undefined;
    }

    await this.pluginRegistry.stopPlugins(this.logger as never, this.plugins);
    this.plugins = [];

    await this.tryClearLegacyUi("shutdown");

    this.client?.close();
    this.client = undefined;
    this.ui = undefined;
    this.callbacks = undefined;
    this.version = undefined;
    this.systemInfo = undefined;
  }

  private async tryClearLegacyUi(trigger: "startup" | "shutdown"): Promise<void> {
    if (!this.ui) {
      return;
    }

    try {
      await this.ui.hideWidget();
      for (const widgetId of LEGACY_WIDGET_IDS) {
        await this.ui.clearWidget(widgetId);
      }
      this.logger.info({ trigger, widgetIds: LEGACY_WIDGET_IDS }, "Cleared legacy in-game widgets");
    } catch (error) {
      this.logger.warn({ error, trigger }, "Failed to clear legacy in-game widgets");
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
