import type { PlayerManialinkPageAnswerEvent } from "../../core/callbacks.js";
import { entry, frame, label, manialink, quad, renderManialink } from "../../ui/manialink.js";
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

interface PlayerMxState {
  query: string;
  results: SmxMapSummary[];
  busy: boolean;
  error?: string;
}

export class ManiaExchangePlugin implements ControllerPlugin {
  public readonly id = "maniaexchange";

  private context?: PluginContext;
  private settings = DEFAULT_SETTINGS;
  private readonly playerState = new Map<string, PlayerMxState>();
  private readonly connectedPlayers = new Set<string>();

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

    context.callbacks.on("manialink-answer", (event) => {
      void this.handleManialinkAnswer(event as PlayerManialinkPageAnswerEvent);
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

  private async openPanel(login: string): Promise<void> {
    const state = this.getPlayerState(login);
    await this.renderSidebarEntry([login]);
    await this.renderPanel(login, state);
  }

  private async searchAndRender(login: string, query: string): Promise<void> {
    const state = this.getPlayerState(login);
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
    } catch (error) {
      this.context?.logger.error({ error, login, mapId }, "SMX import failed from panel");
      state.error = `Import failed for #${mapId}`;
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
            posn: "156 -17 5"
          },
          renderSidebarEntryContent()
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
      busy: false
    } satisfies PlayerMxState;
    this.playerState.set(login, created);
    return created;
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
  const rows = state.results.slice(0, 4).flatMap((result, index) => {
    const rowY = 6.5 - index * 6;
    return [
      quad({
        posn: "0 " + rowY + " 1",
        sizen: "112 5",
        style: "Bgs1InRace",
        substyle: index % 2 === 0 ? "BgCard1" : "BgCard"
      }),
      label({
        posn: "-52 " + (rowY - 1.3) + " 2",
        sizen: "66 3.5",
        halign: "left",
        textcolor: "fff",
        textsize: "1",
        textemboss: "1",
        text: `#${result.mapId} ${truncate(result.gbxMapName ?? result.name ?? "unknown", 32)}`
      }),
      label({
        posn: "20 " + (rowY - 1.3) + " 2",
        sizen: "18 3.5",
        halign: "left",
        textcolor: "7fd",
        textsize: "0.95",
        textemboss: "1",
        text: truncate(result.author ?? "-", 14)
      }),
      quad({
        posn: "44 " + (rowY - 0.7) + " 2",
        sizen: "14 3.8",
        style: "Bgs1InRace",
        substyle: "BgCard1",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      }),
      label({
        posn: "46 " + (rowY - 1.4) + " 3",
        sizen: "10 3",
        textcolor: "fff",
        textsize: "0.9",
        textemboss: "1",
        text: "Import",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      })
    ];
  });

  return renderManialink(
    manialink(MX_PANEL_ID, [
      frame(
        {
          posn: "0 35 20"
        },
        [
          quad({
            sizen: "120 42",
            style: "Bgs1InRace",
            substyle: "BgTitleShadow"
          }),
          label({
            posn: "-55 17 2",
            sizen: "40 3",
            halign: "left",
            style: "TextTitle1",
            textcolor: "fff",
            textsize: "1.5",
            textemboss: "1",
            text: "SMX Import"
          }),
          quad({
            posn: "56 17 2",
            sizen: "5 5",
            bgcolor: "a22d",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "57.4 15.9 3",
            textcolor: "fff",
            textsize: "1.2",
            textemboss: "1",
            text: "X",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "-55 9 2",
            halign: "left",
            textcolor: "fff",
            textsize: "1.1",
            textemboss: "1",
            text: "Search ShootMania Exchange"
          }),
          entry({
            posn: "-55 5 2",
            sizen: "74 4",
            name: SEARCH_ENTRY_NAME,
            default: state.query,
            textsize: "1",
            style: "TextValueSmall"
          }),
          quad({
            posn: "26 5 2",
            sizen: "16 4",
            style: "Bgs1InRace",
            substyle: "BgCard1",
            action: ACTION_SEARCH
          }),
          label({
            posn: "29 4 3",
            textcolor: "fff",
            textsize: "1",
            textemboss: "1",
            text: state.busy ? "..." : "Search",
            action: ACTION_SEARCH
          }),
          label({
            posn: "-55 0 2",
            halign: "left",
            textsize: "0.9",
            textcolor: state.error ? "f88" : "aaa",
            textemboss: "1",
            text: state.error
              ? stripColorCodes(state.error)
              : state.results.length > 0
                ? `${state.results.length} result(s)`
                : "Search ShootMania Exchange"
          }),
          ...rows
        ]
      )
    ])
  );
}

function renderSidebarEntryContent(): Array<ReturnType<typeof quad> | ReturnType<typeof label>> {
  return [
    quad({
      sizen: "6 6",
      style: "Bgs1InRace",
      substyle: "BgTitleShadow"
    }),
    label({
      posn: "0 -0.5 2",
      sizen: "5 2",
      style: "TextTitle1",
      textcolor: "fff",
      text: "SMX",
      textsize: "0.85",
      textemboss: "1",
      action: ACTION_OPEN_PANEL
    }),
    quad({
      posn: "0 -3.5 1",
      sizen: "6 0.5",
      bgcolor: "08bf"
    })
  ];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function stripColorCodes(value: string): string {
  return value.replaceAll(/\$[0-9a-fk-orzs]/gi, "");
}
