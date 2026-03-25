import { argv } from "node:process";

import { loadConfig } from "./config/load-config.js";
import { ControllerApp } from "./core/controller.js";
import { createLogger } from "./logging/logger.js";

async function main(): Promise<void> {
  const configPath = getConfigPath(argv) ?? "maniacontrol.local.json";
  const config = await loadConfig(configPath);
  const logger = createLogger(config.controller.logLevel);
  const app = new ControllerApp(config, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    await app.shutdown();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.run();
}

function getConfigPath(args: string[]): string | undefined {
  const flagIndex = args.findIndex((arg) => arg === "--config");
  if (flagIndex === -1) {
    return undefined;
  }
  return args[flagIndex + 1];
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
