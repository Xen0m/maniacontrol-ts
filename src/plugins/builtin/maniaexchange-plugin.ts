import type { PlayerChatEvent, PlayerManialinkPageAnswerEvent } from "../../core/callbacks.js";
import { frame, manialink, renderManialink } from "../../ui/manialink.js";
import { buildDefaultListRows, buildDefaultMapSearch } from "../../ui/list-helpers.js";
import { SidebarMenuManager } from "../../ui/sidebar-menu-manager.js";
import { buildMainWindow } from "../../ui/window-manager.js";
import type { ControllerPlugin, PluginContext } from "../plugin.js";
import { MapImportService } from "../../maps/map-import-service.js";
import type { SmxMapSummary } from "../../integrations/mania-exchange/smx-client.js";

interface ManiaExchangePluginSettings {
  mapsDirectory: string;
  targetRelativeDirectory: string;
  importOnStartIds: number[];
  insertMode: "add" | "insert";
  announceImports: boolean;
  showWidget: boolean;
  searchLimit: number;
  defaultQuery: string;
}

const DEFAULT_SETTINGS: ManiaExchangePluginSettings = {
  mapsDirectory: "./server/UserData/Maps/My Maps/SMX",
  targetRelativeDirectory: "My Maps\\SMX",
  importOnStartIds: [],
  insertMode: "add",
  announceImports: true,
  showWidget: true,
  searchLimit: 6,
  defaultQuery: "elite"
};

const MX_WIDGET_ID = "maniacontrol-ts.maniaexchange.sidebar";
const MX_PANEL_ID = "maniacontrol-ts.maniaexchange.panel";
const ACTION_OPEN_PANEL = "maniacontrol.ts.mx.open";
const ACTION_CLOSE_PANEL = "maniacontrol.ts.mx.close";
const ACTION_SEARCH = "maniacontrol.ts.mx.search";
const ACTION_IMPORT_PREFIX = "maniacontrol.ts.mx.import.";
const SEARCH_ENTRY_NAME = "maniacontrol.ts.mx.query";
const SIDEBAR_ENTRY_ID = "maniacontrol-ts.sidebar.maniaexchange";
const SIDEBAR_ENTRY_ORDER = 0;

interface PlayerMxState {
  query: string;
  results: SmxMapSummary[];
  busy: boolean;
  panelOpen: boolean;
  error?: string;
}

export class ManiaExchangePlugin implements ControllerPlugin {
  public readonly id = "maniaexchange";

  private context?: PluginContext;
  private settings = DEFAULT_SETTINGS;
  private readonly playerState = new Map<string, PlayerMxState>();
  private readonly connectedPlayers = new Set<string>();
  private readonly sidebar = new SidebarMenuManager();

  public async setup(context: PluginContext): Promise<void> {
    this.context = context;
    this.settings = parseSettings(context.pluginConfig.settings);

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
      query: this.settings.defaultQuery,
      results: [],
      busy: false,
      panelOpen: false
    } satisfies PlayerMxState;
    this.playerState.set(login, created);
    return created;
  }

  private renderSidebarEntryContent() {
    const entry = this.sidebar.renderEntry(SIDEBAR_ENTRY_ID, "shootmania");
    return (entry?.children ?? []).filter((child) => typeof child !== "string");
  }
}

function parseSettings(settings: Record<string, unknown> | undefined): ManiaExchangePluginSettings {
  return {
    mapsDirectory:
      typeof settings?.mapsDirectory === "string"
        ? settings.mapsDirectory
        : DEFAULT_SETTINGS.mapsDirectory,
    targetRelativeDirectory:
      typeof settings?.targetRelativeDirectory === "string"
        ? settings.targetRelativeDirectory
        : DEFAULT_SETTINGS.targetRelativeDirectory,
    importOnStartIds: Array.isArray(settings?.importOnStartIds)
      ? settings.importOnStartIds.filter((value): value is number => typeof value === "number")
      : DEFAULT_SETTINGS.importOnStartIds,
    insertMode: settings?.insertMode === "insert" ? "insert" : DEFAULT_SETTINGS.insertMode,
    announceImports:
      typeof settings?.announceImports === "boolean"
        ? settings.announceImports
        : DEFAULT_SETTINGS.announceImports,
    showWidget:
      typeof settings?.showWidget === "boolean"
        ? settings.showWidget
        : DEFAULT_SETTINGS.showWidget,
    searchLimit:
      typeof settings?.searchLimit === "number" && settings.searchLimit > 0
        ? Math.floor(settings.searchLimit)
        : DEFAULT_SETTINGS.searchLimit,
    defaultQuery:
      typeof settings?.defaultQuery === "string" && settings.defaultQuery.trim().length > 0
        ? settings.defaultQuery.trim()
        : DEFAULT_SETTINGS.defaultQuery
  };
}

function formatMapLabel(map: { name?: string; gbxMapName?: string; author?: string }): string {
  const name = map.gbxMapName ?? map.name ?? "unknown";
  return map.author ? `${name}$fff by $0bf${map.author}` : name;
}

function renderSmxPanel(state: PlayerMxState): string {
  const rows = buildDefaultListRows(
    state.results.slice(0, 5).map((result) => ({
      left: `#${result.mapId} ${truncate(result.gbxMapName ?? result.name ?? "unknown", 21)}`,
      right: truncate(result.author ?? "-", 10),
      action: `${ACTION_IMPORT_PREFIX}${result.mapId}`,
      actionLabel: "Import"
    }))
  );

  const statusText = state.error
    ? stripColorCodes(state.error)
    : state.results.length > 0
      ? `${state.results.length} result(s)`
      : "Search ShootMania Exchange";
  const statusColor = state.error ? "f88" : "aaa";

  return renderManialink(
    manialink(MX_PANEL_ID, [
      buildMainWindow(
        "SMX Import",
        ACTION_CLOSE_PANEL,
        [
          ...buildDefaultMapSearch({
            entryName: SEARCH_ENTRY_NAME,
            defaultValue: state.query,
            searchAction: ACTION_SEARCH,
            statusText,
            statusColor
          }),
          ...rows
        ],
        {
          posn: "-92 34 20",
          size: "86 44"
        }
      )
    ])
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function stripColorCodes(value: string): string {
  return value.replaceAll(/\$[0-9a-fk-orzs]/gi, "");
}
