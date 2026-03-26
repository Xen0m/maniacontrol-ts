import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface AdminAuditEntry {
  timestamp: string;
  action: string;
  method: string;
  path: string;
  client?: string;
  success: boolean;
  detail?: Record<string, unknown>;
}

export class AdminAuditLog {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  public async append(entry: AdminAuditEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  public async readRecent(limit = 100): Promise<AdminAuditEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const lines = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-Math.max(1, limit));

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as AdminAuditEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is AdminAuditEntry => entry !== null)
        .reverse();
    } catch {
      return [];
    }
  }
}
