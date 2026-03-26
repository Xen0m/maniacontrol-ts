import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, normalize, resolve } from "node:path";

import type { AdminModePresetConfig } from "../config/schema.js";

export interface ModeAssetDescriptor {
  kind: "script" | "matchSettings";
  label: string;
  reference: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean | null;
}

export type ModeAssetStatusKind = "installed" | "partial" | "missing" | "unchecked" | "virtual";

export interface ModeAssetStatus {
  kind: ModeAssetStatusKind;
  canApply: boolean;
  checksAvailable: boolean;
  checkedAssetCount: number;
  missingAssetCount: number;
  rootPath: string;
  rootExists: boolean;
  assets: ModeAssetDescriptor[];
}

export interface ModeCatalogEntry extends AdminModePresetConfig {
  status: ModeAssetStatus;
}

interface BuildModeCatalogOptions {
  modePresets: AdminModePresetConfig[];
  serverFilesRoot: string;
}

export async function buildModeCatalog(options: BuildModeCatalogOptions): Promise<ModeCatalogEntry[]> {
  const rootPath = resolve(options.serverFilesRoot);
  const rootExists = await pathExists(rootPath);

  return Promise.all(
    options.modePresets.map(async (preset) => ({
      ...preset,
      status: await resolvePresetStatus(preset, rootPath, rootExists)
    }))
  );
}

async function resolvePresetStatus(
  preset: AdminModePresetConfig,
  rootPath: string,
  rootExists: boolean
): Promise<ModeAssetStatus> {
  const assets = [
    preset.scriptName ? buildScriptAsset(rootPath, preset.scriptName) : null,
    preset.matchSettings ? buildMatchSettingsAsset(rootPath, preset.matchSettings) : null
  ].filter((entry): entry is ModeAssetDescriptor => Boolean(entry));

  if (assets.length === 0) {
    return {
      kind: "virtual",
      canApply: true,
      checksAvailable: false,
      checkedAssetCount: 0,
      missingAssetCount: 0,
      rootPath,
      rootExists,
      assets: []
    };
  }

  if (!rootExists) {
    return {
      kind: "unchecked",
      canApply: true,
      checksAvailable: false,
      checkedAssetCount: 0,
      missingAssetCount: 0,
      rootPath,
      rootExists,
      assets: assets.map((asset) => ({
        ...asset,
        exists: null
      }))
    };
  }

  const checkedAssets = await Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      exists: await pathExists(asset.absolutePath)
    }))
  );

  const existingCount = checkedAssets.filter((asset) => asset.exists).length;
  const missingCount = checkedAssets.length - existingCount;
  const kind = existingCount === checkedAssets.length
    ? "installed"
    : existingCount === 0
      ? "missing"
      : "partial";

  return {
    kind,
    canApply: missingCount === 0,
    checksAvailable: true,
    checkedAssetCount: checkedAssets.length,
    missingAssetCount: missingCount,
    rootPath,
    rootExists,
    assets: checkedAssets
  };
}

function buildScriptAsset(rootPath: string, scriptName: string): ModeAssetDescriptor {
  const normalizedScript = normalizeRelativePath(scriptName);
  return {
    kind: "script",
    label: "Mode script",
    reference: scriptName,
    relativePath: join("GameData", "Scripts", "Modes", normalizedScript),
    absolutePath: resolve(rootPath, "GameData", "Scripts", "Modes", normalizedScript),
    exists: null
  };
}

function buildMatchSettingsAsset(rootPath: string, matchSettings: string): ModeAssetDescriptor {
  const normalizedRelative = normalizeRelativePath(
    matchSettings.replace(/^MatchSettings[\\/]+/i, "")
  );
  return {
    kind: "matchSettings",
    label: "MatchSettings",
    reference: matchSettings,
    relativePath: join("UserData", "Maps", "MatchSettings", normalizedRelative),
    absolutePath: resolve(rootPath, "UserData", "Maps", "MatchSettings", normalizedRelative),
    exists: null
  };
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
