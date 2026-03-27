const SHOOTMANIA_ELITE_TITLE = "SMStormElite@nadeolabs";
const DEFAULT_HISTORY_LIMIT = 20;

export interface EliteStartTurnPayload {
  attacker?: string;
  defenders?: string[];
}

export interface EliteEndTurnPayload {
  victorytype?: number;
}

export interface ElitePluginSettings {
  historyLimit: number;
  logTurns: boolean;
  logStateSnapshots: boolean;
  autoPauseEnabled: boolean;
  showWidget: boolean;
}

export interface EliteTurnState {
  number: number;
  attacker?: string;
  defenders: string[];
  startedAt: string;
  endedAt?: string;
  victoryType?: number;
  victoryLabel?: string;
}

export interface EliteStateSnapshot {
  activeTitle: string;
  pauseSupported: boolean;
  paused: boolean | null;
  turnNumber: number;
  currentTurn: EliteTurnState | null;
  lastCompletedTurn: EliteTurnState | null;
  history: EliteTurnState[];
  stats: {
    turnsStarted: number;
    turnsCompleted: number;
    attackerWins: number;
    defenderWins: number;
    timeLimitWins: number;
    captures: number;
    attackerEliminated: number;
    defendersEliminated: number;
  };
}

export { DEFAULT_HISTORY_LIMIT, SHOOTMANIA_ELITE_TITLE };

export function createElitePluginSettings(settings: Record<string, unknown> | undefined): ElitePluginSettings {
  const historyLimit = Number(settings?.historyLimit);
  return {
    historyLimit:
      Number.isInteger(historyLimit) && historyLimit > 0 ? historyLimit : DEFAULT_HISTORY_LIMIT,
    logTurns: settings?.logTurns !== false,
    logStateSnapshots: settings?.logStateSnapshots === true,
    autoPauseEnabled: settings?.autoPauseEnabled === true,
    showWidget: settings?.showWidget === true
  };
}

export function createInitialEliteState(activeTitle = SHOOTMANIA_ELITE_TITLE): EliteStateSnapshot {
  return {
    activeTitle,
    pauseSupported: false,
    paused: null,
    turnNumber: 0,
    currentTurn: null,
    lastCompletedTurn: null,
    history: [],
    stats: {
      turnsStarted: 0,
      turnsCompleted: 0,
      attackerWins: 0,
      defenderWins: 0,
      timeLimitWins: 0,
      captures: 0,
      attackerEliminated: 0,
      defendersEliminated: 0
    }
  };
}

export function resetEliteState(state: EliteStateSnapshot): EliteStateSnapshot {
  return {
    ...createInitialEliteState(state.activeTitle),
    pauseSupported: state.pauseSupported,
    paused: state.paused
  };
}

export function applyPauseStatus(
  state: EliteStateSnapshot,
  payload: { active?: boolean; available?: boolean } | undefined
): EliteStateSnapshot {
  return {
    ...state,
    paused: typeof payload?.active === "boolean" ? payload.active : state.paused,
    pauseSupported: typeof payload?.available === "boolean" ? payload.available : state.pauseSupported
  };
}

export function startEliteTurn(
  state: EliteStateSnapshot,
  payload: EliteStartTurnPayload | undefined,
  nowIso: string
): EliteStateSnapshot {
  const turnNumber = state.turnNumber + 1;
  return {
    ...state,
    turnNumber,
    currentTurn: {
      number: turnNumber,
      attacker: payload?.attacker,
      defenders: payload?.defenders ?? [],
      startedAt: nowIso
    },
    stats: {
      ...state.stats,
      turnsStarted: state.stats.turnsStarted + 1
    }
  };
}

export function endEliteTurn(
  state: EliteStateSnapshot,
  payload: EliteEndTurnPayload | undefined,
  historyLimit: number,
  nowIso: string
): EliteStateSnapshot {
  const currentTurn = state.currentTurn ?? {
    number: state.turnNumber + 1,
    defenders: [],
    startedAt: nowIso
  };

  const completedTurn = {
    ...currentTurn,
    endedAt: nowIso,
    victoryType: payload?.victorytype,
    victoryLabel: getVictoryLabel(payload?.victorytype)
  } satisfies EliteTurnState;

  const history = [completedTurn, ...state.history].slice(0, historyLimit);
  const nextState: EliteStateSnapshot = {
    ...state,
    currentTurn: null,
    lastCompletedTurn: completedTurn,
    history,
    stats: {
      ...state.stats,
      turnsCompleted: state.stats.turnsCompleted + 1
    }
  };

  applyVictoryStats(nextState, payload?.victorytype);
  return nextState;
}

export function getVictoryLabel(victoryType: number | undefined): string | undefined {
  switch (victoryType) {
    case 1:
      return "TimeLimit";
    case 2:
      return "Capture";
    case 3:
      return "AttackerEliminated";
    case 4:
      return "DefendersEliminated";
    default:
      return undefined;
  }
}

export function formatTurnStartMessage(turnNumber: number, attacker: string | undefined): string {
  if (attacker) {
    return `$fffElite turn $ff0#${turnNumber}$fff started. Attacker: $ff0${attacker}`;
  }
  return `$fffElite turn $ff0#${turnNumber}$fff started.`;
}

export function formatTurnEndMessage(turnNumber: number, victoryLabel: string | undefined): string {
  if (victoryLabel) {
    return `$fffElite turn $ff0#${turnNumber}$fff ended: $ff0${victoryLabel}`;
  }
  return `$fffElite turn $ff0#${turnNumber}$fff ended.`;
}

function applyVictoryStats(state: EliteStateSnapshot, victoryType: number | undefined): void {
  switch (victoryType) {
    case 1:
      state.stats.defenderWins += 1;
      state.stats.timeLimitWins += 1;
      break;
    case 2:
      state.stats.attackerWins += 1;
      state.stats.captures += 1;
      break;
    case 3:
      state.stats.defenderWins += 1;
      state.stats.attackerEliminated += 1;
      break;
    case 4:
      state.stats.attackerWins += 1;
      state.stats.defendersEliminated += 1;
      break;
    default:
      break;
  }
}
