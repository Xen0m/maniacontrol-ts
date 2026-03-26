import { buildDefaultListRows, buildDefaultMapSearch } from "./list-helpers.js";
import { buildSidebarButtonContent } from "./sidebar-menu-manager.js";
import { buildMainWindow, buildStatusWindow } from "./window-manager.js";
import type { WindowOptions } from "./window-manager.js";
import { label } from "./manialink.js";

type LayoutNode =
  | ReturnType<typeof label>
  | ReturnType<typeof import("./manialink.js").quad>
  | ReturnType<typeof import("./manialink.js").entry>
  | ReturnType<typeof import("./manialink.js").frame>;

export interface PanelRow {
  left: string;
  right: string;
  action?: string;
}

export interface StatusRow {
  label: string;
  value: string;
}

export function buildSidebarButton(text: string, action: string) {
  return buildSidebarButtonContent(text, action);
}

export function buildMainPanelShell(
  title: string,
  closeAction: string,
  children: LayoutNode[],
  posn = "0 35 20",
  size = "120 42"
) {
  return buildMainWindow(title, closeAction, children, { posn, size });
}

export function buildSearchSection(
  entryName: string,
  defaultValue: string,
  searchAction: string,
  statusText: string,
  statusColor: string
) {
  return buildDefaultMapSearch({
    entryName,
    defaultValue,
    searchAction,
    statusText,
    statusColor
  });
}

export function buildPanelRows(rows: PanelRow[]) {
  return buildDefaultListRows(
    rows.map((row) => ({
      left: row.left,
      right: row.right,
      action: row.action,
      actionLabel: row.action ? "Import" : undefined
    }))
  );
}

export function buildStatusWidget(
  title: string,
  rows: StatusRow[],
  footer: string,
  posn = "140 85 5",
  size = "48 12.5"
) {
  const children: LayoutNode[] = [
    ...rows.flatMap((row, index) => {
      const rowY = -3.3 - index * 2.2;
      return [
        label({
          posn: `-43 ${rowY} 2`,
          sizen: "10 2",
          halign: "left",
          textcolor: "ddd",
          textsize: "0.8",
          textemboss: "1",
          text: row.label
        }),
        label({
          posn: `-31 ${rowY} 2`,
          sizen: "26 2",
          halign: "left",
          textcolor: "fff",
          textsize: "0.82",
          textemboss: "1",
          text: row.value
        })
      ];
    }),
    label({
      posn: "-43 -11.2 2",
      sizen: "38 2",
      halign: "left",
      textcolor: "fff",
      textsize: "0.78",
      textemboss: "1",
      text: footer
    })
  ];

  return buildStatusWindow(title, children, { posn, size } satisfies WindowOptions);
}
