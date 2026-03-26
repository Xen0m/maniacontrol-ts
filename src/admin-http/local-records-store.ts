import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DedicatedMapInfo, DedicatedRankingEntry } from "../transport/dedicated-client.js";

export interface LocalRecordEntry {
  login?: string;
  nickName?: string;
  score?: number;
  bestTime?: number;
  updatedAt: string;
}

export interface LocalMapRecordSnapshot {
  mapUid?: string;
  mapName?: string;
  fileName?: string;
  updatedAt: string;
  entries: LocalRecordEntry[];
}

interface LocalRecordsState {
  maps: Record<string, LocalMapRecordSnapshot>;
}

export class LocalRecordsStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  public async recordMapRanking(map: DedicatedMapInfo, ranking: DedicatedRankingEntry[]): Promise<LocalMapRecordSnapshot | null> {
    const mapUid = map.uId?.trim();
    if (!mapUid) {
      return null;
    }

    const state = await this.readState();
    const previous = state.maps[mapUid];
    const merged = mergeEntries(previous?.entries ?? [], ranking);
    const snapshot: LocalMapRecordSnapshot = {
      mapUid,
      mapName: map.name,
      fileName: map.fileName,
      updatedAt: new Date().toISOString(),
      entries: merged,
    };
    state.maps[mapUid] = snapshot;
    await this.writeState(state);
    return snapshot;
  }

  public async getCurrentMapRecords(mapUid?: string): Promise<LocalMapRecordSnapshot | null> {
    if (!mapUid) {
      return null;
    }
    const state = await this.readState();
    return state.maps[mapUid] ?? null;
  }

  public async listMaps(limit = 20): Promise<LocalMapRecordSnapshot[]> {
    const state = await this.readState();
    return Object.values(state.maps)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.max(1, limit));
  }

  private async readState(): Promise<LocalRecordsState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as LocalRecordsState;
      if (parsed && typeof parsed === "object" && parsed.maps && typeof parsed.maps === "object") {
        return parsed;
      }
      return { maps: {} };
    } catch {
      return { maps: {} };
    }
  }

  private async writeState(state: LocalRecordsState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function mergeEntries(
  previous: LocalRecordEntry[],
  ranking: DedicatedRankingEntry[]
): LocalRecordEntry[] {
  const byLogin = new Map(previous.map((entry) => [entry.login || "", entry]));

  for (const entry of ranking) {
    const login = entry.login?.trim();
    if (!login) {
      continue;
    }
    const nextEntry: LocalRecordEntry = {
      login,
      nickName: entry.nickName,
      score: entry.score,
      bestTime: entry.bestTime,
      updatedAt: new Date().toISOString(),
    };
    const current = byLogin.get(login);
    if (!current || isBetterRecord(nextEntry, current)) {
      byLogin.set(login, nextEntry);
    }
  }

  return [...byLogin.values()]
    .sort(compareRecords)
    .slice(0, 10);
}

function isBetterRecord(nextEntry: LocalRecordEntry, current: LocalRecordEntry): boolean {
  const nextScore = typeof nextEntry.score === "number" ? nextEntry.score : Number.NEGATIVE_INFINITY;
  const currentScore = typeof current.score === "number" ? current.score : Number.NEGATIVE_INFINITY;
  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  const nextTime = typeof nextEntry.bestTime === "number" ? nextEntry.bestTime : Number.POSITIVE_INFINITY;
  const currentTime = typeof current.bestTime === "number" ? current.bestTime : Number.POSITIVE_INFINITY;
  return nextTime < currentTime;
}

function compareRecords(left: LocalRecordEntry, right: LocalRecordEntry): number {
  const leftScore = typeof left.score === "number" ? left.score : Number.NEGATIVE_INFINITY;
  const rightScore = typeof right.score === "number" ? right.score : Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const leftTime = typeof left.bestTime === "number" ? left.bestTime : Number.POSITIVE_INFINITY;
  const rightTime = typeof right.bestTime === "number" ? right.bestTime : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}
