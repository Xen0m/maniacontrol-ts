import { describe, expect, it } from "vitest";

import {
  applyPauseStatus,
  createElitePluginSettings,
  createInitialEliteState,
  endEliteTurn,
  formatTurnEndMessage,
  formatTurnStartMessage,
  resetEliteState,
  startEliteTurn
} from "./state.js";

describe("elite state helpers", () => {
  it("creates sane default settings", () => {
    expect(createElitePluginSettings(undefined)).toEqual({
      historyLimit: 20,
      logTurns: true,
      logStateSnapshots: false,
      autoPauseEnabled: false,
      showWidget: false
    });
  });

  it("resets transient turn data while preserving pause state", () => {
    const initial = createInitialEliteState();
    const started = startEliteTurn(
      {
        ...initial,
        pauseSupported: true,
        paused: true
      },
      { attacker: "attacker-1", defenders: ["def-1"] },
      "2026-03-27T10:00:00.000Z"
    );

    expect(resetEliteState(started)).toEqual({
      ...createInitialEliteState(),
      pauseSupported: true,
      paused: true
    });
  });

  it("tracks turn lifecycle and victory stats", () => {
    const started = startEliteTurn(
      createInitialEliteState(),
      { attacker: "attacker-1", defenders: ["def-1", "def-2"] },
      "2026-03-27T10:00:00.000Z"
    );
    const ended = endEliteTurn(
      started,
      { victorytype: 2 },
      5,
      "2026-03-27T10:01:00.000Z"
    );

    expect(started.currentTurn?.number).toBe(1);
    expect(ended.currentTurn).toBeNull();
    expect(ended.lastCompletedTurn?.victoryLabel).toBe("Capture");
    expect(ended.history).toHaveLength(1);
    expect(ended.stats.turnsStarted).toBe(1);
    expect(ended.stats.turnsCompleted).toBe(1);
    expect(ended.stats.attackerWins).toBe(1);
    expect(ended.stats.captures).toBe(1);
  });

  it("applies pause status updates incrementally", () => {
    const state = applyPauseStatus(createInitialEliteState(), {
      active: true,
      available: true
    });

    expect(state.paused).toBe(true);
    expect(state.pauseSupported).toBe(true);
  });

  it("formats chat messages predictably", () => {
    expect(formatTurnStartMessage(3, "attacker-1")).toContain("#3");
    expect(formatTurnEndMessage(3, "Capture")).toContain("Capture");
  });
});
