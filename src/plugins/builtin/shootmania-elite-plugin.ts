import type { ControllerPlugin, PluginContext } from "../plugin.js";
import type { PlayerChatEvent } from "../../core/callbacks.js";
import { ELITE_WIDGET_ID, renderEliteStateWidget } from "./elite/render.js";
import {
  applyPauseStatus,
  createElitePluginSettings,
  createInitialEliteState,
  endEliteTurn,
  formatTurnEndMessage,
  formatTurnStartMessage,
  resetEliteState,
  SHOOTMANIA_ELITE_TITLE,
  startEliteTurn,
  type EliteEndTurnPayload,
  type ElitePluginSettings,
  type EliteStartTurnPayload,
  type EliteStateSnapshot
} from "./elite/state.js";

const STATE_CHANGED_EVENT = "Plugin.ShootManiaElite.StateChanged";

export type { EliteStateSnapshot };

export class ShootManiaElitePlugin implements ControllerPlugin {
  public readonly id = "shootmania-elite";

  private context?: PluginContext;
  private settings: ElitePluginSettings = createElitePluginSettings(undefined);
  private state: EliteStateSnapshot = createInitialEliteState();
  private readonly connectedPlayers = new Set<string>();

  public async setup(context: PluginContext): Promise<void> {
    this.context = context;
    this.settings = createElitePluginSettings(context.pluginConfig.settings);
    await context.ui.clearWidget(ELITE_WIDGET_ID);

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
      this.state = resetEliteState(this.state);
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
    });

    context.callbacks.on("Maniaplanet.Pause.Status", (event) => {
      this.state = applyPauseStatus(
        this.state,
        event.payload as { active?: boolean; available?: boolean } | undefined
      );
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

    context.callbacks.on("player-chat:command", (event) => {
      void this.handleChatCommand(event as PlayerChatEvent);
    });
  }

  private handleEliteStartTurn(payload: EliteStartTurnPayload | undefined): void {
    this.state = startEliteTurn(this.state, payload, new Date().toISOString());
    const currentTurn = this.state.currentTurn;
    if (!currentTurn) {
      return;
    }

    if (this.settings.logTurns) {
      this.context?.logger.info(
        {
          turnNumber: currentTurn.number,
          attacker: currentTurn.attacker,
          defenders: currentTurn.defenders
        },
        "Elite turn started"
      );
      void this.context?.ui.sendInfo(
        formatTurnStartMessage(currentTurn.number, currentTurn.attacker)
      );
    }

    this.emitStateChanged("turn-start");
    void this.renderWidgetForActivePlayers();
  }

  private handleEliteEndTurn(payload: EliteEndTurnPayload | undefined): void {
    this.state = endEliteTurn(
      this.state,
      payload,
      this.settings.historyLimit,
      new Date().toISOString()
    );
    const currentTurn = this.state.lastCompletedTurn;
    if (!currentTurn) {
      return;
    }

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

  private async handleChatCommand(event: PlayerChatEvent): Promise<void> {
    if (!this.context || !event.login || !event.commandText) {
      return;
    }

    const [root, subcommand] = event.commandText.split(/\s+/);
    if (root?.toLowerCase() !== "elite") {
      return;
    }

    if (!subcommand || subcommand.toLowerCase() === "help") {
      await this.context.ui.sendInfo("Elite commands: /elite pause, /elite resume", [event.login]);
      return;
    }

    if (!this.state.pauseSupported) {
      await this.context.ui.sendError("Pause is not supported by the current mode.", [event.login]);
      return;
    }

    if (subcommand.toLowerCase() === "pause") {
      await this.context.client.setPauseActive(true);
      this.state.paused = true;
      await this.context.ui.sendSuccess("Elite match paused.", [event.login]);
      void this.renderWidgetForActivePlayers();
      return;
    }

    if (subcommand.toLowerCase() === "resume") {
      await this.context.client.setPauseActive(false);
      this.state.paused = false;
      await this.context.ui.sendSuccess("Elite match resumed.", [event.login]);
      void this.renderWidgetForActivePlayers();
      return;
    }

    await this.context.ui.sendError(`Unknown Elite command: ${subcommand}`, [event.login]);
  }

  public async stop(): Promise<void> {
    await this.context?.ui.clearWidget(ELITE_WIDGET_ID);
  }

  public getStateSnapshot(): EliteStateSnapshot {
    return structuredClone(this.state);
  }

  public async pauseMatch(): Promise<EliteStateSnapshot> {
    if (!this.context) {
      throw new Error("ShootMania Elite plugin is not initialized.");
    }
    if (!this.state.pauseSupported) {
      throw new Error("Pause is not supported by the current mode.");
    }

    await this.context.client.setPauseActive(true);
    this.state.paused = true;
    this.emitStateChanged("pause-status");
    await this.renderWidgetForActivePlayers();
    return this.getStateSnapshot();
  }

  public async resumeMatch(): Promise<EliteStateSnapshot> {
    if (!this.context) {
      throw new Error("ShootMania Elite plugin is not initialized.");
    }
    if (!this.state.pauseSupported) {
      throw new Error("Pause is not supported by the current mode.");
    }

    await this.context.client.setPauseActive(false);
    this.state.paused = false;
    this.emitStateChanged("pause-status");
    await this.renderWidgetForActivePlayers();
    return this.getStateSnapshot();
  }

  private async renderWidget(recipients?: string[]): Promise<void> {
    if (!this.context || !this.settings.showWidget) {
      return;
    }

    const xml = renderEliteStateWidget(this.state);
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
