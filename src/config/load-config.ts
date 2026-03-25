import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { appConfigSchema, type AppConfig } from "./schema.js";

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const absolutePath = resolve(configPath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  return appConfigSchema.parse(parsed);
}
