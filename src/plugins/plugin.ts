import type { Logger } from "pino";

import type { AppConfig, PluginConfig } from "../config/schema.js";
import type { CallbackBus } from "../core/callbacks.js";
import type { DedicatedClient, DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";
import type { UIService } from "../ui/ui-service.js";

export interface ControllerRuntimeContext {
  logger: Logger;
  config: AppConfig;
  callbacks: CallbackBus;
  client: DedicatedClient;
  ui: UIService;
  version: DedicatedVersion;
  systemInfo: DedicatedSystemInfo;
}

export interface PluginContext extends ControllerRuntimeContext {
  pluginConfig: PluginConfig;
}

export interface ControllerPlugin {
  readonly id: string;
  setup(context: PluginContext): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
