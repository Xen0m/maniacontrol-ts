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
            posn: "-146 52 1"
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
    const rowY = -21 - index * 5.7;
    return [
      quad({
        posn: "0 " + rowY + " 1",
        sizen: "98 4.8",
        bgcolor: index % 2 === 0 ? "ffffff10" : "ffffff18"
      }),
      label({
        posn: "-46.5 " + (rowY - 0.8) + " 2",
        sizen: "56 3.4",
        textsize: "1.05",
        text: `$fff#${result.mapId} ${truncate(result.gbxMapName ?? result.name ?? "unknown", 28)}`
      }),
      label({
        posn: "12 " + (rowY - 0.8) + " 2",
        sizen: "18 3.4",
        textsize: "1",
        text: `$7fd${truncate(result.author ?? "-", 11)}`
      }),
      quad({
        posn: "34 " + (rowY - 0.15) + " 2",
        sizen: "15 3.8",
        bgcolor: "1f9bcedd",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      }),
      label({
        posn: "36 " + (rowY - 1) + " 3",
        sizen: "11 3",
        textsize: "1",
        text: "$fffImport",
        action: `${ACTION_IMPORT_PREFIX}${result.mapId}`
      })
    ];
  });

  return renderManialink(
    manialink(MX_PANEL_ID, [
      frame(
        {
          posn: "-98 42 1"
        },
        [
          quad({
            sizen: "108 52",
            bgcolor: "06111ae8"
          }),
          quad({
            posn: "0 0 1",
            sizen: "108 5.2",
            bgcolor: "1694c6ee"
          }),
          label({
            posn: "-50 -1 2",
            textsize: "1.8",
            text: "$fffSMX IMPORT"
          }),
          quad({
            posn: "44 -0.7 2",
            sizen: "7 3.2",
            bgcolor: "0008",
            action: ACTION_TOGGLE_LAUNCHER
          }),
          label({
            posn: "45.4 -1.05 3",
            textsize: "0.95",
            text: "$fff–",
            action: ACTION_TOGGLE_LAUNCHER
          }),
          quad({
            posn: "52 -0.7 2",
            sizen: "7 3.2",
            bgcolor: "a22d",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "53.7 -1.05 3",
            textsize: "0.95",
            text: "$fffX",
            action: ACTION_CLOSE_PANEL
          }),
          label({
            posn: "-50 -8 2",
            textsize: "1.15",
            text: "$9bbSearch ShootMania Exchange"
          }),
          entry({
            posn: "-50 -12.6 2",
            sizen: "64 4.1",
            name: SEARCH_ENTRY_NAME,
            default: state.query,
            textsize: "1.05",
            style: "TextValueSmall"
          }),
          quad({
            posn: "20 -12.6 2",
            sizen: "14 4.1",
            bgcolor: "1f9bcedd",
            action: ACTION_SEARCH
          }),
          label({
            posn: "22 -13.5 3",
            textsize: "1",
            text: state.busy ? "$fff..." : "$fffSearch",
            action: ACTION_SEARCH
          }),
          label({
            posn: "-50 -17 2",
            textsize: "0.95",
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
        sizen: "14 4.8",
        bgcolor: "07141edd",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      quad({
        posn: "0 0 1",
        sizen: "14 0.9",
        bgcolor: "1694c6ff",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      label({
        posn: "1 -1.35 2",
        sizen: "10 2",
        text: "$fffSMX",
        textsize: "1.05",
        action: ACTION_TOGGLE_LAUNCHER
      }),
      label({
        posn: "9.5 -1.3 2",
        sizen: "2 2",
        text: "$fff+",
        textsize: "1.1",
        action: ACTION_TOGGLE_LAUNCHER
      })
    ];
  }

  return [
    quad({
      sizen: "34 6.2",
      bgcolor: "07141edd"
    }),
    quad({
      posn: "0 0 1",
      sizen: "34 1",
      bgcolor: "1694c6ff"
    }),
    label({
      posn: "2 -1.2 2",
      sizen: "18 3",
      text: "$fffSMX IMPORT",
      textsize: "1.25",
      action: ACTION_OPEN_PANEL
    }),
    quad({
      posn: "24 -1 2",
      sizen: "7 3.4",
      bgcolor: "1f9bcedd",
      action: ACTION_OPEN_PANEL
    }),
    label({
      posn: "25.6 -1.15 3",
      sizen: "4 2",
      text: "$fffOpen",
      textsize: "0.95",
      action: ACTION_OPEN_PANEL
    }),
    quad({
      posn: "31.5 -1 2",
      sizen: "2.5 3.4",
      bgcolor: "0008",
      action: ACTION_TOGGLE_LAUNCHER
    }),
    label({
      posn: "32 -1.15 3",
      sizen: "1 2",
      text: "$fff–",
      textsize: "0.95",
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
