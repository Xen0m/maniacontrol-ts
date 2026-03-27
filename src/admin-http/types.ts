import type { IncomingMessage } from "node:http";

import type { DedicatedSystemInfo, DedicatedVersion } from "../transport/dedicated-client.js";

export type AdminRole = "owner" | "operator" | "observer";

export interface ControllerSnapshot {
  startedAt: string;
  version?: DedicatedVersion;
  systemInfo?: DedicatedSystemInfo;
}

export interface AdminAuditContext {
  action: string;
  success: boolean;
  detail?: Record<string, unknown>;
}

export interface ResolvedAdminAuth {
  id: string;
  label?: string;
  role: AdminRole;
  scopes: string[];
}

export interface AuthorizedIncomingMessage extends IncomingMessage {
  adminAuth?: ResolvedAdminAuth;
}
