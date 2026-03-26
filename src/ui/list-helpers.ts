import { entry, label, quad } from "./manialink.js";
import { MANIACONTROL_STYLES } from "./maniacontrol-style.js";

type ListNode = ReturnType<typeof entry> | ReturnType<typeof label> | ReturnType<typeof quad>;

export interface SearchSectionOptions {
  entryName: string;
  defaultValue: string;
  searchAction: string;
  statusText: string;
  statusColor: string;
}

export interface ListRow {
  left: string;
  right: string;
  action?: string;
  actionLabel?: string;
}

export function buildDefaultMapSearch(options: SearchSectionOptions): ListNode[] {
  return [
    label({
      posn: "-55 9 2",
      halign: "left",
      textcolor: MANIACONTROL_STYLES.primaryTextColor,
      textsize: "1.1",
      textemboss: "1",
      text: "Search ShootMania Exchange"
    }),
    entry({
      posn: "-55 5 2",
      sizen: "74 4",
      name: options.entryName,
      default: options.defaultValue,
      textsize: "1",
      style: MANIACONTROL_STYLES.inputTextStyle
    }),
    quad({
      posn: "26 5 2",
      sizen: "16 4",
      style: MANIACONTROL_STYLES.backgroundStyle,
      substyle: MANIACONTROL_STYLES.cardSubstyle,
      action: options.searchAction
    }),
    label({
      posn: "29 4 3",
      textcolor: MANIACONTROL_STYLES.primaryTextColor,
      textsize: "1",
      textemboss: "1",
      text: "Search",
      action: options.searchAction
    }),
    label({
      posn: "-55 0 2",
      halign: "left",
      textsize: "0.9",
      textcolor: options.statusColor,
      textemboss: "1",
      text: options.statusText
    })
  ];
}

export function buildDefaultListRows(rows: ListRow[]): ListNode[] {
  return rows.flatMap((row, index) => {
    const rowY = 6.5 - index * 6;
    return [
      quad({
        posn: `0 ${rowY} 1`,
        sizen: "112 5",
        style: MANIACONTROL_STYLES.backgroundStyle,
        substyle: index % 2 === 0
          ? MANIACONTROL_STYLES.cardSubstyle
          : MANIACONTROL_STYLES.alternateCardSubstyle
      }),
      label({
        posn: `-52 ${rowY - 1.3} 2`,
        sizen: "66 3.5",
        halign: "left",
        textcolor: MANIACONTROL_STYLES.primaryTextColor,
        textsize: "1",
        textemboss: "1",
        text: row.left
      }),
      label({
        posn: `20 ${rowY - 1.3} 2`,
        sizen: "18 3.5",
        halign: "left",
        textcolor: MANIACONTROL_STYLES.accentTextColor,
        textsize: "0.95",
        textemboss: "1",
        text: row.right
      }),
      ...(row.action
        ? [
            quad({
              posn: `44 ${rowY - 0.7} 2`,
              sizen: "14 3.8",
              style: MANIACONTROL_STYLES.backgroundStyle,
              substyle: MANIACONTROL_STYLES.cardSubstyle,
              action: row.action
            }),
            label({
              posn: `46 ${rowY - 1.4} 3`,
              sizen: "10 3",
              textcolor: MANIACONTROL_STYLES.primaryTextColor,
              textsize: "0.9",
              textemboss: "1",
              text: row.actionLabel ?? "Action",
              action: row.action
            })
          ]
        : [])
    ];
  });
}
