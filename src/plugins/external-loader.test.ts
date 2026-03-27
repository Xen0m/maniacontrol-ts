import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  instantiateExternalPlugin,
  loadExternalPlugin,
  resolveExternalPluginSpecifier
} from "./external-loader.js";

describe("external plugin loader", () => {
  it("resolves relative filesystem paths to file URLs", () => {
    const specifier = resolveExternalPluginSpecifier("./plugins/sample-plugin.mjs");
    expect(specifier.startsWith("file://")).toBe(true);
    expect(specifier).toContain("/plugins/sample-plugin.mjs");
  });

  it("accepts createPlugin factories from external modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "maniacontrol-plugin-"));
    const modulePath = join(root, "sample-plugin.mjs");
    await writeFile(modulePath, `
      export async function createPlugin() {
        return {
          id: "sample-plugin",
          async setup() {}
        };
      }
    `, "utf8");

    const plugin = await loadExternalPlugin(modulePath);
    expect(plugin.id).toBe("sample-plugin");
    expect(typeof plugin.setup).toBe("function");
  });

  it("rejects external modules that do not export a controller plugin", async () => {
    await expect(instantiateExternalPlugin({
      default: { nope: true }
    }, "broken-plugin")).rejects.toThrow(/not a valid controller plugin/i);
  });

  it("loads the repository sample external plugin", async () => {
    const plugin = await loadExternalPlugin(join(process.cwd(), "plugins", "sample-external-plugin.mjs"));
    expect(plugin.id).toBe("sample-external");
    expect(typeof plugin.setup).toBe("function");
    expect(typeof plugin.start).toBe("function");
    expect(typeof plugin.stop).toBe("function");
  });
});
