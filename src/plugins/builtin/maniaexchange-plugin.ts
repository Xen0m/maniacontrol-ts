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

const MX_WIDGET_ID = "maniacontrol-ts.maniaexchange.launcher";
const MX_PANEL_ID = "maniacontrol-ts.maniaexchange.panel";
const ACTION_OPEN_PANEL = "maniacontrol.ts.mx.open";
const ACTION_CLOSE_PANEL = "maniacontrol.ts.mx.close";
const ACTION_TOGGLE_LAUNCHER = "maniacontrol.ts.mx.toggle-launcher";
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
  private readonly collapsedLaunchers = new Set<string>();

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
      void this.renderLauncherWidget([login]);
    });

    context.callbacks.on("ManiaPlanet.PlayerDisconnect", (event) => {
      const login = typeof event.params[0] === "string" ? event.params[0] : undefined;
      if (!login) {
        return;
      }

      this.connectedPlayers.delete(login);
      this.collapsedLaunchers.delete(login);
      this.playerState.delete(login);
    });

    if (this.settings.showWidget) {
      await this.renderLauncherWidget();
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
        await this.renderLauncherWidget([event.login]);
      }
      return;
    }

    if (event.answer === ACTION_TOGGLE_LAUNCHER) {
      if (this.collapsedLaunchers.has(event.login)) {
        this.collapsedLaunchers.delete(event.login);
      } else {
        this.collapsedLaunchers.add(event.login);
      }

      await this.renderLauncherWidget([event.login]);
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
    await this.renderLauncherWidget([login]);
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

  private async renderLauncherWidget(recipients?: string[]): Promise<void> {
    if (!this.context || !this.settings.showWidget) {
      return;
    }

    const xml = renderManialink(
      manialink(MX_WIDGET_ID, [
        frame(
          {
            posn: "-154 56 1"
          },
          renderLauncherContent(shouldRenderCollapsedLauncher(recipients, this.collapsedLaunchers))
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
  const rows = state.results.slice(0, 6).flatMap((result, index) => {
    const rowY = -16.5 - index * 4.8;
    return [
      quad({
        posn: "0 " + rowY + " 1",
        sizen: "82 4.1",
        bgcolor: index % 2 === 0 ? "ffffff10" : "ffffff18"
      }),
      label({
        posn: "-39.5 " + (rowY - 0.75) + " 2",
        sizen: "46 3",
        textsize: "0.9",
        textemboss: "1",
        text: `$fff#${result.mapId} ${truncate(result.gbxMapName ?? result.name ?? "unknown", 23)}`
      }),
      label({
        posn: "8 " + (rowY - 0.75) + " 2",
        sizen: "16 3",
        textsize: "0.85",
        textemboss: "1",
        text: `$7fd${truncate(result.author ?? "-", 9)}`
      }),
      quad({
        posn: "28 " + (rowY - 0.1) + " 2",
        sizen: "11 3.2",
        bgcolor: "28bc",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      }),
      label({
        posn: "29.2 " + (rowY - 0.85) + " 3",
        sizen: "8 2.4",
        textsize: "0.82",
        textemboss: "1",
        text: "$fffImport",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      })
    ];
  });

  return renderManialink(
    manialink(MX_PANEL_ID, [
      frame(
        {
          posn: "-148 34 1"
        },
        [
          quad({
            sizen: "90 38",
            bgcolor: "000c"
          }),
          quad({
            posn: "0 0 1",
            sizen: "90 4.2",
            bgcolor: "08bf"
          }),
          label({
            posn: "-42 -0.9 2",
            textsize: "1.25",
            textemboss: "1",
            text: "$fffSMX IMPORT"
          }),
          quad({
            posn: "33 -0.6 2",
            sizen: "5.5 2.6",
            bgcolor: "000a",
            action: ACTION_TOGGLE_LAUNCHER
          }),
          label({
            posn: "34.2 -0.88 3",
            textsize: "0.8",
            textemboss: "1",
            text: "$fff–",
            action: ACTION_TOGGLE_LAUNCHER
          }),
          quad({
            posn: "39.5 -0.6 2",
            sizen: "5.5 2.6",
            bgcolor: "a22d",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "40.9 -0.88 3",
            textsize: "0.8",
            textemboss: "1",
            text: "$fffX",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "-42 -6.5 2",
            textsize: "0.95",
            textemboss: "1",
            text: "$fffSearch ShootMania Exchange"
          }),
          entry({
            posn: "-42 -10.3 2",
            sizen: "51 3.6",
            name: SEARCH_ENTRY_NAME,
            default: state.query,
            textsize: "0.95",
            style: "TextValueSmall"
          }),
          quad({
            posn: "14 -10.3 2",
            sizen: "10 3.6",
            bgcolor: "28bc",
            action: ACTION_SEARCH
          }),
          label({
            posn: "15.4 -11.1 3",
            textsize: "0.82",
            textemboss: "1",
            text: state.busy ? "$fff..." : "$fffSearch",
            action: ACTION_SEARCH
          }),
          label({
            posn: "-42 -13.9 2",
            textsize: "0.82",
            textemboss: "1",
            text: state.error
              ? `$f88${state.error}`
              : state.results.length > 0
                ? `$8f8${state.results.length} result(s)`
                : "$888Click Search to query SMX"
          }),
          ...rows
        ]
      )
    ])
  );
}

function renderLauncherContent(
  collapsed: boolean
): Array<ReturnType<typeof quad> | ReturnType<typeof label>> {
  if (collapsed) {
    return [
      quad({
        sizen: "12 3.6",
        bgcolor: "000c",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      quad({
        posn: "0 0 1",
        sizen: "12 0.8",
        bgcolor: "08bf",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      label({
        posn: "1 -1 2",
        sizen: "8 2",
        text: "$fffSMX",
        textsize: "0.9",
        textemboss: "1",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      label({
        posn: "8.1 -0.95 2",
        sizen: "2 2",
        text: "$fff+",
        textsize: "0.9",
        textemboss: "1",
        action: ACTION_TOGGLE_LAUNCHER
      })
    ];
  }

  return [
    quad({
      sizen: "28 5",
      bgcolor: "000c"
    }),
    quad({
      posn: "0 0 1",
      sizen: "28 0.9",
      bgcolor: "08bf"
    }),
    label({
      posn: "1.6 -0.95 2",
      sizen: "14 2.6",
      text: "$fffSMX IMPORT",
      textsize: "0.95",
      textemboss: "1",
      action: ACTION_OPEN_PANEL
    }),
    quad({
      posn: "18.3 -0.8 2",
      sizen: "5.6 2.8",
      bgcolor: "28bc",
      action: ACTION_OPEN_PANEL
    }),
    label({
      posn: "19.3 -0.98 3",
      sizen: "3 2",
      text: "$fffOpen",
      textsize: "0.72",
      textemboss: "1",
      action: ACTION_OPEN_PANEL
    }),
    quad({
      posn: "24.3 -0.8 2",
      sizen: "3.7 2.8",
      bgcolor: "0008",
      action: ACTION_TOGGLE_LAUNCHER
    }),
    label({
      posn: "25.4 -0.98 3",
      sizen: "1 2",
      text: "$fff–",
      textsize: "0.78",
      textemboss: "1",
      action: ACTION_TOGGLE_LAUNCHER
    })
  ];
}

function shouldRenderCollapsedLauncher(
  recipients: string[] | undefined,
  collapsedLaunchers: ReadonlySet<string>
): boolean {
  if (!recipients || recipients.length === 0) {
    return false;
  }

  return collapsedLaunchers.has(recipients[0]);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
