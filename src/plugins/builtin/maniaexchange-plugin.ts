import type { PlayerChatEvent, PlayerManialinkPageAnswerEvent } from "../../core/callbacks.js";
import { frame, manialink, renderManialink } from "../../ui/manialink.js";
import { SidebarMenuManager } from "../../ui/sidebar-menu-manager.js";
import type { ControllerPlugin, PluginContext } from "../plugin.js";
import { MapImportService } from "../../maps/map-import-service.js";
import type { SmxMapSummary } from "../../integrations/mania-exchange/smx-client.js";
import type { ImportedMapResult } from "../../maps/map-import-service.js";
import {
  ACTION_IMPORT_PREFIX,
  ACTION_SEARCH,
  formatMapLabel,
  MX_PANEL_ID,
  renderSmxPanel,
  SEARCH_ENTRY_NAME
} from "./maniaexchange/render.js";
import {
  createManiaExchangeSettings,
  createPlayerMxState,
  type ManiaExchangePluginSettings,
  type PlayerMxState
} from "./maniaexchange/state.js";

const MX_WIDGET_ID = "maniacontrol-ts.maniaexchange.sidebar";
const ACTION_OPEN_PANEL = "maniacontrol.ts.mx.open";
const ACTION_CLOSE_PANEL = "maniacontrol.ts.mx.close";
const SIDEBAR_ENTRY_ID = "maniacontrol-ts.sidebar.maniaexchange";
const SIDEBAR_ENTRY_ORDER = 0;

export class ManiaExchangePlugin implements ControllerPlugin {
  public readonly id = "maniaexchange";

  private context?: PluginContext;
  private settings = createManiaExchangeSettings(undefined);
  private readonly playerState = new Map<string, PlayerMxState>();
  private readonly connectedPlayers = new Set<string>();
  private readonly sidebar = new SidebarMenuManager();

  public async setup(context: PluginContext): Promise<void> {
    this.context = context;
    this.settings = createManiaExchangeSettings(context.pluginConfig.settings);
    await context.ui.clearWidget(MX_WIDGET_ID);
    await context.ui.clearWidget(MX_PANEL_ID);

    context.logger.info(
      {
        mapsDirectory: this.settings.mapsDirectory,
        targetRelativeDirectory: this.settings.targetRelativeDirectory,
        importOnStartIds: this.settings.importOnStartIds,
        insertMode: this.settings.insertMode,
        showWidget: this.settings.showWidget,
        searchLimit: this.settings.searchLimit
      },
      "ManiaExchange plugin loaded"
    );

    this.sidebar.addEntry({
      id: SIDEBAR_ENTRY_ID,
      order: SIDEBAR_ENTRY_ORDER,
      text: "SMX",
      action: ACTION_OPEN_PANEL
    });

    context.callbacks.on("manialink-answer", (event) => {
      void this.handleManialinkAnswer(event as PlayerManialinkPageAnswerEvent);
    });

    context.callbacks.on("player-chat:command", (event) => {
      void this.handleChatCommand(event as PlayerChatEvent);
    });

    context.callbacks.on("ManiaPlanet.PlayerConnect", (event) => {
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      if (!login || !this.settings.showWidget) {
        return;
      }

      this.connectedPlayers.add(login);
      void this.renderSidebarEntry([login]);
    });

    context.callbacks.on("ManiaPlanet.PlayerDisconnect", (event) => {
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      if (!login) {
        return;
      }

      this.connectedPlayers.delete(login);
      this.playerState.delete(login);
    });

    if (this.settings.showWidget) {
      await this.renderSidebarEntry();
    }
  }

  public async start(): Promise<void> {
    if (!this.context || this.settings.importOnStartIds.length === 0) {
      return;
    }

    const importer = new MapImportService(this.context.client, this.context.logger);
    for (const mapId of this.settings.importOnStartIds) {
      try {
        const result = await importer.importMapById(mapId, {
          mapsDirectory: this.settings.mapsDirectory,
          targetRelativeDirectory: this.settings.targetRelativeDirectory,
          insertMode: this.settings.insertMode
        });

        this.context.logger.info(
          {
            mapId,
            fileName: result.serverFileName,
            insertedWith: result.insertedWith
          },
          "Imported SMX map"
        );

        if (this.settings.announceImports) {
          await this.context.ui.sendInfo(
            `$fffImported MX map $ff0#${result.map.mapId}$fff: ${formatMapLabel(result.map)}`
          );
        }
      } catch (error) {
        this.context.logger.error({ error, mapId }, "Failed to import SMX map");
        if (this.settings.announceImports) {
          await this.context.ui.sendInfo(`$f00Failed to import MX map #${mapId}$fff.`);
        }
      }
    }
  }

  public async stop(): Promise<void> {
    await this.context?.ui.clearWidget(MX_WIDGET_ID);
    await this.context?.ui.clearWidget(MX_PANEL_ID);
  }

  public getSettingsSnapshot(): ManiaExchangePluginSettings {
    return { ...this.settings };
  }

  public async searchMaps(query: string): Promise<SmxMapSummary[]> {
    if (!this.context) {
      throw new Error("ManiaExchange plugin is not initialized.");
    }

    const importer = new MapImportService(this.context.client, this.context.logger);
    const normalizedQuery = query.trim() || this.settings.defaultQuery;
    return importer.searchMaps(normalizedQuery, this.settings.searchLimit);
  }

  public async importMapById(mapId: number): Promise<ImportedMapResult> {
    if (!this.context) {
      throw new Error("ManiaExchange plugin is not initialized.");
    }

    const importer = new MapImportService(this.context.client, this.context.logger);
    return importer.importMapById(mapId, {
      mapsDirectory: this.settings.mapsDirectory,
      targetRelativeDirectory: this.settings.targetRelativeDirectory,
      insertMode: this.settings.insertMode
    });
  }

  private async handleManialinkAnswer(event: PlayerManialinkPageAnswerEvent): Promise<void> {
    if (!this.context || !event.login || !event.answer) {
      return;
    }

    if (event.answer === ACTION_OPEN_PANEL) {
      await this.openPanel(event.login);
      return;
    }

    if (event.answer === ACTION_CLOSE_PANEL) {
      const state = this.getPlayerState(event.login);
      state.panelOpen = false;
      await this.context.ui.clearWidget(MX_PANEL_ID, [event.login]);
      if (this.settings.showWidget) {
        await this.renderSidebarEntry([event.login]);
      }
      return;
    }

    if (event.answer === ACTION_SEARCH) {
      const query = event.entries.find((entryValue) => entryValue.name === SEARCH_ENTRY_NAME)?.value?.trim()
        || this.getPlayerState(event.login).query;
      await this.searchAndRender(event.login, query);
      return;
    }

    if (event.answer.startsWith(ACTION_IMPORT_PREFIX)) {
      const mapId = Number(event.answer.slice(ACTION_IMPORT_PREFIX.length));
      if (Number.isInteger(mapId) && mapId > 0) {
        await this.importAndRender(event.login, mapId);
      }
    }
  }

  private async handleChatCommand(event: PlayerChatEvent): Promise<void> {
    if (!this.context || !event.login || !event.commandText) {
      return;
    }

    const [root, subcommand, ...rest] = event.commandText.split(/\s+/);
    if (root?.toLowerCase() !== "mx") {
      return;
    }

    if (!subcommand || subcommand.toLowerCase() === "help") {
      await this.context.ui.sendInfo(
        "MX commands: /mx open, /mx search <query>, /mx add <mapId>",
        [event.login]
      );
      return;
    }

    if (subcommand.toLowerCase() === "open") {
      await this.openPanel(event.login);
      return;
    }

    if (subcommand.toLowerCase() === "search") {
      const query = rest.join(" ").trim();
      if (!query) {
        await this.context.ui.sendError("Usage: /mx search <query>", [event.login]);
        return;
      }

      await this.searchAndRender(event.login, query);
      return;
    }

    if (subcommand.toLowerCase() === "add" || subcommand.toLowerCase() === "import") {
      const mapId = Number(rest[0]);
      if (!Number.isInteger(mapId) || mapId <= 0) {
        await this.context.ui.sendError("Usage: /mx add <mapId>", [event.login]);
        return;
      }

      await this.importAndRender(event.login, mapId);
      return;
    }

    await this.context.ui.sendError(`Unknown MX command: ${subcommand}`, [event.login]);
  }

  private async openPanel(login: string): Promise<void> {
    const state = this.getPlayerState(login);
    state.panelOpen = true;
    await this.renderSidebarEntry([login]);
    await this.renderPanel(login, state);
  }

  private async searchAndRender(login: string, query: string): Promise<void> {
    const state = this.getPlayerState(login);
    state.panelOpen = true;
    state.query = query || this.settings.defaultQuery;
    state.busy = true;
    state.error = undefined;
    await this.renderPanel(login, state);

    const importer = new MapImportService(this.context!.client, this.context!.logger);
    try {
      state.results = await importer.searchMaps(state.query, this.settings.searchLimit);
      if (state.results.length === 0) {
        state.error = "No maps found";
      }
    } catch (error) {
      this.context?.logger.error({ error, login, query: state.query }, "SMX search failed");
      state.error = "SMX search failed";
      state.results = [];
    } finally {
      state.busy = false;
    }

    await this.renderPanel(login, state);
  }

  private async importAndRender(login: string, mapId: number): Promise<void> {
    const state = this.getPlayerState(login);
    state.panelOpen = true;
    state.busy = true;
    state.error = undefined;
    await this.renderPanel(login, state);

    const importer = new MapImportService(this.context!.client, this.context!.logger);
    try {
      const result = await importer.importMapById(mapId, {
        mapsDirectory: this.settings.mapsDirectory,
        targetRelativeDirectory: this.settings.targetRelativeDirectory,
        insertMode: this.settings.insertMode
      });

      await this.context?.ui.sendInfo(
        `$fffImported MX map $ff0#${result.map.mapId}$fff: ${formatMapLabel(result.map)}`,
        [login]
      );
      state.results = state.results.filter((map) => map.mapId !== mapId);
      await this.context?.ui.sendSuccess(`Imported MX map #${result.map.mapId}`, [login]);
    } catch (error) {
      this.context?.logger.error({ error, login, mapId }, "SMX import failed from panel");
      state.error = `Import failed for #${mapId}`;
      await this.context?.ui.sendError(`Import failed for #${mapId}`, [login]);
    } finally {
      state.busy = false;
    }

    await this.renderPanel(login, state);
  }

  private async renderSidebarEntry(recipients?: string[]): Promise<void> {
    if (!this.context || !this.settings.showWidget) {
      return;
    }

    const xml = renderManialink(
      manialink(MX_WIDGET_ID, [
        frame(
          {
            posn: this.sidebar.getEntryPosition(SIDEBAR_ENTRY_ID, "shootmania") ?? "146 -24 5"
          },
          this.renderSidebarEntryContent()
        )
      ])
    );

    await this.context.ui.showWidget(xml, recipients);
    this.context.ui.logWidgetUpdate(MX_WIDGET_ID);
  }

  private async renderPanel(login: string, state: PlayerMxState): Promise<void> {
    if (!this.context) {
      return;
    }

    const xml = renderSmxPanel(state);
    await this.context.ui.showWidget(xml, [login]);
    this.context.ui.logWidgetUpdate(MX_PANEL_ID);
  }

  private getPlayerState(login: string): PlayerMxState {
    const existing = this.playerState.get(login);
    if (existing) {
      return existing;
    }

    const created = {
      ...createPlayerMxState(this.settings.defaultQuery)
    } satisfies PlayerMxState;
    this.playerState.set(login, created);
    return created;
  }

  private renderSidebarEntryContent() {
    const entry = this.sidebar.renderEntry(SIDEBAR_ENTRY_ID, "shootmania");
    return (entry?.children ?? []).filter((child) => typeof child !== "string");
  }
}
