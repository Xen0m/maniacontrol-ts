import { manialink, renderManialink } from "../../../ui/manialink.js";
import { buildDefaultListRows, buildDefaultMapSearch } from "../../../ui/list-helpers.js";
import { buildMainWindow } from "../../../ui/window-manager.js";
import type { PlayerMxState } from "./state.js";

const ACTION_SEARCH = "maniacontrol.ts.mx.search";
const ACTION_IMPORT_PREFIX = "maniacontrol.ts.mx.import.";
const MX_PANEL_ID = "maniacontrol-ts.maniaexchange.panel";
const SEARCH_ENTRY_NAME = "maniacontrol.ts.mx.query";

export { ACTION_IMPORT_PREFIX, ACTION_SEARCH, MX_PANEL_ID, SEARCH_ENTRY_NAME };

export function formatMapLabel(map: { name?: string; gbxMapName?: string; author?: string }): string {
  const name = map.gbxMapName ?? map.name ?? "unknown";
  return map.author ? `${name}$fff by $0bf${map.author}` : name;
}

export function renderSmxPanel(state: PlayerMxState): string {
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
        "maniacontrol.ts.mx.close",
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
