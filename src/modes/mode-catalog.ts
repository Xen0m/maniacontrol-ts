import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";

import type { AdminModePresetConfig } from "../config/schema.js";
import {
  buildModePresetAssets,
  type ModeAssetDescriptor,
  planModePresetInstall
} from "./mode-preset-assets.js";

export type ModeAssetStatusKind = "installed" | "partial" | "missing" | "unchecked" | "virtual";

export interface ModeAssetStatus {
  kind: ModeAssetStatusKind;
  canApply: boolean;
  canInstall: boolean;
  checksAvailable: boolean;
  checkedAssetCount: number;
  missingAssetCount: number;
  installableAssetCount: number;
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
  const assets = buildModePresetAssets(preset, rootPath);

  if (assets.length === 0) {
    return {
      kind: "virtual",
      canApply: true,
      canInstall: false,
      checksAvailable: false,
      checkedAssetCount: 0,
      missingAssetCount: 0,
      installableAssetCount: 0,
      rootPath,
      rootExists,
      assets: []
    };
  }

  if (!rootExists) {
    return {
      kind: "unchecked",
      canApply: true,
      canInstall: false,
      checksAvailable: false,
      checkedAssetCount: 0,
      missingAssetCount: 0,
      installableAssetCount: 0,
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
  const installPlan = await planModePresetInstall(preset, rootPath);

  const existingCount = checkedAssets.filter((asset) => asset.exists).length;
  const missingCount = checkedAssets.length - existingCount;
  const kind = existingCount === checkedAssets.length
    ? "installed"
    : existingCount === 0
      ? "missing"
      : "partial";

  return {
    kind,
    canApply: missingCount === 0 || installPlan.installableAssetCount >= missingCount,
    canInstall: installPlan.installableAssetCount > 0,
    checksAvailable: true,
    checkedAssetCount: checkedAssets.length,
    missingAssetCount: missingCount,
    installableAssetCount: installPlan.installableAssetCount,
    rootPath,
    rootExists,
    assets: checkedAssets
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
