import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppConfig } from "../config/schema.js";
import type { ManiaExchangePlugin } from "../plugins/builtin/maniaexchange-plugin.js";
import type { ShootManiaElitePlugin } from "../plugins/builtin/shootmania-elite-plugin.js";
import { buildModeCatalog } from "../modes/mode-catalog.js";
import type { DedicatedClient } from "../transport/dedicated-client.js";
import type { AdminActivityLog } from "./activity-log.js";
import type { AdminAuditLog } from "./audit-log.js";
import type { LocalRecordsStore } from "./local-records-store.js";
import type { SseHub } from "./sse-hub.js";
import type { AdminAuditContext, ControllerSnapshot, ResolvedAdminAuth } from "./types.js";

export interface AdminRouteContext {
  config: NonNullable<AppConfig["admin"]>;
  client: DedicatedClient;
  sseHub: SseHub;
  auditLog: AdminAuditLog;
  activityLog: AdminActivityLog;
  localRecordsStore: LocalRecordsStore;
  getSnapshot: () => ControllerSnapshot;
  getElitePlugin: () => ShootManiaElitePlugin | undefined;
  getManiaExchangePlugin: () => ManiaExchangePlugin | undefined;
  getModeCatalog: () => Promise<Awaited<ReturnType<typeof buildModeCatalog>>>;
  readJsonBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  writeJson: (
    response: ServerResponse,
    statusCode: number,
    body: unknown,
    audit?: AdminAuditContext
  ) => Promise<void>;
  writeForbidden: (
    response: ServerResponse,
    auth: ResolvedAdminAuth,
    requiredScope: string
  ) => Promise<void>;
}
