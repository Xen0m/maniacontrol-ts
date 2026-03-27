import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

import type { ControllerPlugin } from "./plugin.js";

interface ExternalPluginModule {
  default?: unknown;
  plugin?: unknown;
  createPlugin?: unknown;
}

export async function loadExternalPlugin(modulePath: string): Promise<ControllerPlugin> {
  const imported = await import(resolveExternalPluginSpecifier(modulePath));
  return instantiateExternalPlugin(imported, modulePath);
}

export function resolveExternalPluginSpecifier(modulePath: string): string {
  const trimmed = String(modulePath || "").trim();
  if (!trimmed) {
    throw new Error("plugin module path is required");
  }

  if (trimmed.startsWith("node:")) {
    return trimmed;
  }

  if (trimmed.startsWith("file://")) {
    return trimmed;
  }

  if (trimmed.startsWith(".") || isAbsolute(trimmed)) {
    return pathToFileURL(resolve(trimmed)).href;
  }

  return trimmed;
}

export async function instantiateExternalPlugin(
  imported: ExternalPluginModule,
  modulePath = "external-plugin"
): Promise<ControllerPlugin> {
  if (typeof imported.createPlugin === "function") {
    const plugin = await imported.createPlugin();
    return validatePlugin(plugin, modulePath, "createPlugin()");
  }

  if (imported.plugin !== undefined) {
    return validatePlugin(imported.plugin, modulePath, "plugin");
  }

  if (imported.default !== undefined) {
    return validatePlugin(imported.default, modulePath, "default");
  }

  throw new Error(`Module "${modulePath}" must export default, plugin, or createPlugin()`);
}

function validatePlugin(value: unknown, modulePath: string, source: string): ControllerPlugin {
  if (!isControllerPlugin(value)) {
    throw new Error(`Module "${modulePath}" export "${source}" is not a valid controller plugin`);
  }
  return value;
}

function isControllerPlugin(value: unknown): value is ControllerPlugin {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ControllerPlugin>;
  return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.setup === "function";
}
