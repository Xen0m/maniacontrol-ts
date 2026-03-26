import { z } from "zod";

export const pluginConfigSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).optional()
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
    token: z.string().min(1)
  }).optional(),
  storage: z.object({
    driver: z.enum(["sqlite", "postgres"]).default("sqlite"),
    url: z.string().min(1)
  }).optional(),
  plugins: z.array(pluginConfigSchema).default([])
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type PluginConfig = z.infer<typeof pluginConfigSchema>;
