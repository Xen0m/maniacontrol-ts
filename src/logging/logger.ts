import pino, { type Logger } from "pino";

export function createLogger(level: pino.LevelWithSilent = "info"): Logger {
  return pino({
    name: "maniacontrol-ts",
    level
  });
}
