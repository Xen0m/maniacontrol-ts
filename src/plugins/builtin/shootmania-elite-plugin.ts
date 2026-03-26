import type { ControllerPlugin, PluginContext } from "../plugin.js";
import { frame, label, manialink, quad, renderManialink } from "../../ui/manialink.js";

const SHOOTMANIA_ELITE_TITLE = "SMStormElite@nadeolabs";
const DEFAULT_HISTORY_LIMIT = 20;
const STATE_CHANGED_EVENT = "Plugin.ShootManiaElite.StateChanged";
const ELITE_WIDGET_ID = "maniacontrol-ts.elite.state";
const ACTION_TOGGLE_WIDGET = "maniacontrol.ts.elite.toggle";

interface EliteStartTurnPayload {
  attacker?: string;
  defenders?: string[];
}

interface EliteEndTurnPayload {
  victorytype?: number;
}

interface ElitePluginSettings {
  historyLimit: number;
  logTurns: boolean;
  logStateSnapshots: boolean;
  autoPauseEnabled: boolean;
  showWidget: boolean;
}

interface EliteTurnState {
  number: number;
  attacker?: string;
  defenders: string[];
  startedAt: string;
  endedAt?: string;
  victoryType?: number;
  victoryLabel?: string;
}

interface EliteStateSnapshot {
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

export class ShootManiaElitePlugin implements ControllerPlugin {
  public readonly id = "shootmania-elite";

  private context?: PluginContext;
  private settings: ElitePluginSettings = {
    historyLimit: DEFAULT_HISTORY_LIMIT,
    logTurns: true,
    logStateSnapshots: false,
    autoPauseEnabled: false,
    showWidget: true
  };
  private state: EliteStateSnapshot = {
    activeTitle: SHOOTMANIA_ELITE_TITLE,
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
  private readonly connectedPlayers = new Set<string>();
  private readonly collapsedPlayers = new Set<string>();

  public async setup(context: PluginContext): Promise<void> {
    this.context = context;
    this.settings = parseSettings(context.pluginConfig.settings);

    if (context.systemInfo.titleId !== SHOOTMANIA_ELITE_TITLE) {
      context.logger.warn(
        { titleId: context.systemInfo.titleId },
        "ShootMania Elite plugin loaded on a different title"
      );
      return;
    }

    this.state.pauseSupported = await context.client.modeSupportsPause();

    context.logger.info(
      {
        settings: this.settings,
        pauseSupported: this.state.pauseSupported
      },
      "ShootMania Elite state plugin loaded"
    );

    if (this.settings.showWidget) {
      await this.renderWidget();
    }

    context.callbacks.on("ManiaPlanet.BeginMap", () => {
      this.resetState();
      this.emitStateChanged("map-reset");
      context.logger.info("Re-rendering Elite widget after BeginMap");
      void this.renderWidgetForActivePlayers();
    });

    context.callbacks.on("ManiaPlanet.PlayerConnect", (event) => {
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      if (!login || !this.settings.showWidget) {
        return;
      }

      this.connectedPlayers.add(login);
      context.logger.info({ login }, "Sending Elite widget to connected player");
      void this.renderWidget([login]);
    });

    context.callbacks.on("ManiaPlanet.PlayerDisconnect", (event) => {
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      if (!login) {
        return;
      }

      this.connectedPlayers.delete(login);
      this.collapsedPlayers.delete(login);
    });

    context.callbacks.on(`manialink-answer:${ACTION_TOGGLE_WIDGET}`, (event) => {
      const login = "login" in event && typeof event.login === "string" ? event.login : undefined;
      if (!login) {
        return;
      }

      if (this.collapsedPlayers.has(login)) {
        this.collapsedPlayers.delete(login);
      } else {
        this.collapsedPlayers.add(login);
      }

      void this.renderWidget([login]);
    });

    context.callbacks.on("Maniaplanet.Pause.Status", (event) => {
      const payload = event.payload as { active?: boolean; available?: boolean } | undefined;
      if (typeof payload?.active === "boolean") {
        this.state.paused = payload.active;
      }
      if (typeof payload?.available === "boolean") {
        this.state.pauseSupported = payload.available;
      }
      this.emitStateChanged("pause-status");
      void this.renderWidgetForActivePlayers();
    });

    context.callbacks.on("Shootmania.Elite.StartTurn", (event) => {
      const payload = event.payload as EliteStartTurnPayload | undefined;
      this.handleEliteStartTurn(payload);
    });

    context.callbacks.on("Shootmania.Elite.EndTurn", (event) => {
      const payload = event.payload as EliteEndTurnPayload | undefined;
      this.handleEliteEndTurn(payload);
    });
  }

  private resetState(): void {
    this.state = {
      activeTitle: SHOOTMANIA_ELITE_TITLE,
      pauseSupported: this.state.pauseSupported,
      paused: this.state.paused,
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

  private handleEliteStartTurn(payload: EliteStartTurnPayload | undefined): void {
    this.state.turnNumber += 1;
    this.state.stats.turnsStarted += 1;
    this.state.currentTurn = {
      number: this.state.turnNumber,
      attacker: payload?.attacker,
      defenders: payload?.defenders ?? [],
      startedAt: new Date().toISOString()
    };

    if (this.settings.logTurns) {
      this.context?.logger.info(
        {
          turnNumber: this.state.currentTurn.number,
          attacker: this.state.currentTurn.attacker,
          defenders: this.state.currentTurn.defenders
        },
        "Elite turn started"
      );
      void this.context?.ui.sendInfo(
        formatTurnStartMessage(this.state.currentTurn.number, this.state.currentTurn.attacker)
      );
    }

    this.emitStateChanged("turn-start");
    void this.renderWidgetForActivePlayers();
  }

  private handleEliteEndTurn(payload: EliteEndTurnPayload | undefined): void {
    const currentTurn = this.state.currentTurn ?? {
      number: this.state.turnNumber + 1,
      defenders: [],
      startedAt: new Date().toISOString()
    };

    currentTurn.endedAt = new Date().toISOString();
    currentTurn.victoryType = payload?.victorytype;
    currentTurn.victoryLabel = getVictoryLabel(payload?.victorytype);

    this.state.currentTurn = null;
    this.state.lastCompletedTurn = currentTurn;
    this.state.history.unshift(currentTurn);
    this.state.history = this.state.history.slice(0, this.settings.historyLimit);
    this.state.stats.turnsCompleted += 1;
    applyVictoryStats(this.state, payload?.victorytype);

    if (this.settings.logTurns) {
      this.context?.logger.info(
        {
          turnNumber: currentTurn.number,
          attacker: currentTurn.attacker,
          defenders: currentTurn.defenders,
          victoryType: currentTurn.victoryType,
          victoryLabel: currentTurn.victoryLabel
        },
        "Elite turn ended"
      );
      void this.context?.ui.sendInfo(
        formatTurnEndMessage(currentTurn.number, currentTurn.victoryLabel)
      );
    }

    this.emitStateChanged("turn-end");
    void this.renderWidgetForActivePlayers();
  }

  private emitStateChanged(reason: "map-reset" | "turn-start" | "turn-end" | "pause-status"): void {
    if (!this.context) {
      return;
    }

    const snapshot = structuredClone(this.state);
    this.context.callbacks.emit(STATE_CHANGED_EVENT, {
      reason,
      state: snapshot
    });

    if (this.settings.logStateSnapshots) {
      this.context.logger.debug({ reason, state: snapshot }, "Elite state updated");
    }
  }

  public async stop(): Promise<void> {
    if (this.settings.showWidget) {
      await this.context?.ui.clearWidget(ELITE_WIDGET_ID);
    }
  }

  private async renderWidget(recipients?: string[]): Promise<void> {
    if (!this.context || !this.settings.showWidget) {
      return;
    }

    const xml = renderEliteStateWidget(this.state, shouldRenderCollapsed(recipients, this.collapsedPlayers));
    if (recipients && recipients.length > 0) {
      this.context.logger.debug({ recipients }, "Rendering Elite widget to specific recipients");
    } else {
      this.context.logger.debug("Rendering Elite widget globally");
    }
    await this.context.ui.showWidget(xml, recipients);
    this.context.ui.logWidgetUpdate(ELITE_WIDGET_ID);
  }

  private async renderWidgetForActivePlayers(): Promise<void> {
    if (!this.context || !this.settings.showWidget) {
      return;
    }

    if (this.connectedPlayers.size === 0) {
      await this.renderWidget();
      return;
    }

    await Promise.all(
      [...this.connectedPlayers].map((login) => this.renderWidget([login]))
    );
  }
}

function parseSettings(settings: Record<string, unknown> | undefined): ElitePluginSettings {
  const historyLimit = Number(settings?.historyLimit);
  return {
    historyLimit:
      Number.isInteger(historyLimit) && historyLimit > 0 ? historyLimit : DEFAULT_HISTORY_LIMIT,
    logTurns: settings?.logTurns !== false,
    logStateSnapshots: settings?.logStateSnapshots === true,
    autoPauseEnabled: settings?.autoPauseEnabled === true,
    showWidget: settings?.showWidget !== false
  };
}

function getVictoryLabel(victoryType: number | undefined): string | undefined {
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

function formatTurnStartMessage(turnNumber: number, attacker: string | undefined): string {
  if (attacker) {
    return `$fffElite turn $ff0#${turnNumber}$fff started. Attacker: $ff0${attacker}`;
  }
  return `$fffElite turn $ff0#${turnNumber}$fff started.`;
}

function formatTurnEndMessage(turnNumber: number, victoryLabel: string | undefined): string {
  if (victoryLabel) {
    return `$fffElite turn $ff0#${turnNumber}$fff ended: $ff0${victoryLabel}`;
  }
  return `$fffElite turn $ff0#${turnNumber}$fff ended.`;
}

function renderEliteStateWidget(state: EliteStateSnapshot, collapsed = false): string {
  const lastTurn = state.lastCompletedTurn;
  const currentTurn = state.currentTurn;
  const summaryLines = [
    { labelText: "$999Pause", valueText: formatPauseState(state.paused, state.pauseSupported) },
    { labelText: "$999Turn", valueText: `$fff${currentTurn?.number ?? state.turnNumber}` },
    { labelText: "$999Attacker", valueText: `$fff${currentTurn?.attacker ?? lastTurn?.attacker ?? "-"}` },
    {
      labelText: "$999Defenders",
      valueText: `$fff${truncate((currentTurn?.defenders ?? lastTurn?.defenders ?? []).join(", ") || "-", 24)}`
    },
    { labelText: "$999Last", valueText: `$fff${lastTurn?.victoryLabel ?? "-"}` }
  ];

  return renderManialink(
    manialink(ELITE_WIDGET_ID, [
      frame(
        {
          posn: "118 58 1"
        },
        collapsed ? renderCollapsedEliteWidget() : renderExpandedEliteWidget(summaryLines, state)
      )
    ])
  );
}

function renderExpandedEliteWidget(
  lines: Array<{ labelText: string; valueText: string }>,
  state: EliteStateSnapshot
): Array<ReturnType<typeof quad> | ReturnType<typeof label>> {
  return [
    quad({
      posn: "0 0 0",
      sizen: "54 31",
      halign: "right",
      valign: "top",
      bgcolor: "08131dee"
    }),
    quad({
      posn: "0 0 1",
      sizen: "54 4.4",
      halign: "right",
      valign: "top",
      bgcolor: "0b9fe0dd"
    }),
    quad({
      posn: "-46.5 -0.6 2",
      sizen: "5.4 2.9",
      bgcolor: "ffffff22"
    }),
    label({
      posn: "-39.5 -1.1 2",
      sizen: "28 3",
      halign: "left",
      textsize: 1.4,
      text: "$fffELITE CONTROL"
    }),
    quad({
      posn: "-6 -0.8 2",
      sizen: "4.2 2.8",
      bgcolor: "0008",
      action: ACTION_TOGGLE_WIDGET
    }),
    label({
      posn: "-4.8 -1.15 3",
      sizen: "2 2",
      textsize: 1.1,
      text: "$fff–",
      action: ACTION_TOGGLE_WIDGET
    }),
    ...lines.flatMap((line, index) => {
      const rowY = -6.7 - index * 4.5;
      return [
        label({
          posn: "-50 " + rowY + " 2",
          sizen: "14 3",
          halign: "left",
          textsize: 1,
          text: line.labelText
        }),
        label({
          posn: "-33 " + rowY + " 2",
          sizen: "29 3",
          halign: "left",
          textsize: 1.05,
          text: line.valueText
        })
      ];
    }),
    quad({
      posn: "-50 -29 1",
      sizen: "46 3.4",
      bgcolor: "ffffff12"
    }),
    label({
      posn: "-48.5 -29.6 2",
      sizen: "44 3",
      halign: "left",
      textsize: 1.05,
      text: `$0f0A ${state.stats.attackerWins}$fff  ·  $f33D ${state.stats.defenderWins}$fff  ·  $999Done $fff${state.stats.turnsCompleted}`
    })
  ];
}

function renderCollapsedEliteWidget(): Array<ReturnType<typeof quad> | ReturnType<typeof label>> {
  return [
    quad({
      posn: "0 0 0",
      sizen: "20 4.8",
      halign: "right",
      valign: "top",
      bgcolor: "08131ddd",
      action: ACTION_TOGGLE_WIDGET
    }),
    quad({
      posn: "0 0 1",
      sizen: "20 0.9",
      halign: "right",
      valign: "top",
      bgcolor: "0b9fe0ff",
      action: ACTION_TOGGLE_WIDGET
    }),
    label({
      posn: "-16.8 -1.35 2",
      sizen: "16 2",
      halign: "left",
      textsize: 1.15,
      text: "$fffELITE",
      action: ACTION_TOGGLE_WIDGET
    }),
    label({
      posn: "-4.2 -1.3 2",
      sizen: "3 2",
      textsize: 1.15,
      text: "$fff+",
      action: ACTION_TOGGLE_WIDGET
    })
  ];
}

function shouldRenderCollapsed(
  recipients: string[] | undefined,
  collapsedPlayers: ReadonlySet<string>
): boolean {
  if (!recipients || recipients.length === 0) {
    return false;
  }

  return collapsedPlayers.has(recipients[0]);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatPauseState(paused: boolean | null, supported: boolean): string {
  if (!supported) {
    return "$888unsupported";
  }
  if (paused === true) {
    return "$f80paused";
  }
  if (paused === false) {
    return "$0f0running";
  }
  return "$ff0unknown";
}
