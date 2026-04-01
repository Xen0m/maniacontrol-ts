import { access, copyFile, mkdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

import type { AdminModePresetConfig } from "../config/schema.js";

export interface ModeAssetDescriptor {
  kind: "script" | "matchSettings";
  label: string;
  reference: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean | null;
}

export interface ModeAssetInstallDescriptor extends ModeAssetDescriptor {
  sourcePath: string | null;
  sourceAbsolutePath: string | null;
  sourceExists: boolean;
}

export interface ModePresetInstallPlan {
  canInstall: boolean;
  installableAssetCount: number;
  assets: ModeAssetInstallDescriptor[];
}

export interface InstallModePresetAssetsResult extends ModePresetInstallPlan {
  installedAssetCount: number;
  installedAssets: ModeAssetInstallDescriptor[];
}

export function buildModePresetAssets(
  preset: AdminModePresetConfig,
  serverFilesRoot: string
): ModeAssetDescriptor[] {
  const rootPath = resolve(serverFilesRoot);
  return [
    preset.scriptName ? buildScriptAsset(rootPath, preset.scriptName) : null,
    preset.matchSettings ? buildMatchSettingsAsset(rootPath, preset.matchSettings) : null
  ].filter((entry): entry is ModeAssetDescriptor => Boolean(entry));
}

export async function planModePresetInstall(
  preset: AdminModePresetConfig,
  serverFilesRoot: string
): Promise<ModePresetInstallPlan> {
  const assets = buildModePresetAssets(preset, serverFilesRoot);
  const withSources = await Promise.all(assets.map(async (asset) => {
    const sourcePath = resolveAssetSourcePath(asset, preset);
    const sourceAbsolutePath = sourcePath ? resolve(sourcePath) : null;
    const sourceExists = sourceAbsolutePath ? await pathExists(sourceAbsolutePath) : false;
    return {
      ...asset,
      sourcePath,
      sourceAbsolutePath,
      sourceExists
    };
  }));

  const installableAssets = withSources.filter((asset) => asset.sourceExists);
  return {
    canInstall: installableAssets.length > 0,
    installableAssetCount: installableAssets.length,
    assets: withSources
  };
}

export async function installModePresetAssets(
  preset: AdminModePresetConfig,
  serverFilesRoot: string
): Promise<InstallModePresetAssetsResult> {
  const plan = await planModePresetInstall(preset, serverFilesRoot);
  const installedAssets: ModeAssetInstallDescriptor[] = [];

  for (const asset of plan.assets) {
    if (asset.exists || !asset.sourceExists || !asset.sourceAbsolutePath) {
      continue;
    }
    await mkdir(dirname(asset.absolutePath), { recursive: true });
    await copyFile(asset.sourceAbsolutePath, asset.absolutePath);
    installedAssets.push({
      ...asset,
      exists: true
    });
  }

  return {
    ...plan,
    installedAssetCount: installedAssets.length,
    installedAssets
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

function resolveAssetSourcePath(
  asset: ModeAssetDescriptor,
  preset: AdminModePresetConfig
): string | null {
  const explicitSource = asset.kind === "script"
    ? preset.scriptSourcePath
    : preset.matchSettingsSourcePath;
  if (explicitSource) {
    return explicitSource;
  }

  if (asset.kind === "script") {
    return resolve("vendor", "maniaplanet-scripts", "Modes", normalizeRelativePath(asset.reference));
  }

  const normalizedMatchSettings = normalizeRelativePath(
    asset.reference.replace(/^MatchSettings[\\/]+/i, "")
  );
  return resolve("vendor", "maniaplanet-scripts", "MatchSettings", normalizedMatchSettings);
}

function normalizeRelativePath(value: string): string {
  return normalize(
    value
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
  ).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\.([/\\]|$)/, "").replace(/\\/g, "/");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
