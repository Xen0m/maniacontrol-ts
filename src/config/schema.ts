import { z } from "zod";

export const pluginConfigSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).optional()
});

export const adminPrincipalConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  role: z.enum(["owner", "operator", "observer"]).default("operator"),
  token: z.string().min(1),
  scopes: z.array(z.string().min(1)).default(["read"])
});

export const adminModePresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  scriptName: z.string().min(1).optional(),
  scriptSourcePath: z.string().min(1).optional(),
  matchSettings: z.string().min(1).optional(),
  matchSettingsSourcePath: z.string().min(1).optional(),
  modeSettings: z.record(z.string(), z.unknown()).optional(),
  restartAfterApply: z.boolean().default(false)
});

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.enum(["User", "Admin", "SuperAdmin"]),
    password: z.string().min(1)
  }),
  controller: z.object({
    apiVersion: z.string().default("2013-04-16"),
    scriptApiVersion: z.string().default("2.5.0"),
    enableCallbacks: z.boolean().default(true),
    pollIntervalMs: z.number().int().positive().default(100),
    logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
  }),
  admin: z.object({
    enabled: z.boolean().default(false),
    host: z.string().min(1).default("127.0.0.1"),
    port: z.number().int().positive().default(3001),
    serverFilesRoot: z.string().min(1).default("./server"),
    token: z.string().min(1).optional(),
    principals: z.array(adminPrincipalConfigSchema).default([]),
    modePresets: z.array(adminModePresetSchema).default([]),
    auditPath: z.string().min(1).default("./data/admin-audit.jsonl"),
    activityPath: z.string().min(1).default("./data/admin-activity.jsonl"),
    localRecordsPath: z.string().min(1).default("./data/local-records.json"),
    chatLoggingEnabled: z.boolean().default(false)
  }).refine(
    (value) => Boolean(value.token) || value.principals.length > 0,
    "admin.token or admin.principals must be configured"
  ).optional(),
  storage: z.object({
    driver: z.enum(["sqlite", "postgres"]).default("sqlite"),
    url: z.string().min(1)
  }).optional(),
  plugins: z.array(pluginConfigSchema).default([])
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type PluginConfig = z.infer<typeof pluginConfigSchema>;
export type AdminPrincipalConfig = z.infer<typeof adminPrincipalConfigSchema>;
export type AdminModePresetConfig = z.infer<typeof adminModePresetSchema>;
