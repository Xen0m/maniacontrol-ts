import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface AdminActivityEntry {
  timestamp: string;
  category: string;
  type: string;
  summary: string;
  login?: string;
  actorId?: string;
  actorRole?: string;
  payload?: Record<string, unknown>;
}

export interface ReadActivityOptions {
  limit?: number;
  category?: string;
  login?: string;
}

export class AdminActivityLog {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  public async append(entry: AdminActivityEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  public async readRecent(options: ReadActivityOptions = {}): Promise<AdminActivityEntry[]> {
    const limit = Math.max(1, options.limit ?? 100);
    try {
      const raw = await readFile(this.filePath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const entries = lines
        .map((line) => {
          try {
            return JSON.parse(line) as AdminActivityEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is AdminActivityEntry => entry !== null)
        .filter((entry) => {
          if (options.category && entry.category !== options.category) {
            return false;
          }
          if (options.login && entry.login !== options.login) {
            return false;
          }
          return true;
        });

      return entries.slice(-limit).reverse();
    } catch {
      return [];
    }
  }
}
