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
      posn: "-38 10.5 2",
      halign: "left",
      textcolor: MANIACONTROL_STYLES.primaryTextColor,
      textsize: "1.05",
      textemboss: "1",
      text: "Search ShootMania Exchange"
    }),
    entry({
      posn: "-38 6 2",
      sizen: "48 4.2",
      name: options.entryName,
      default: options.defaultValue,
      textsize: "1.05",
      style: MANIACONTROL_STYLES.inputTextStyle
    }),
    quad({
      posn: "17 6 2",
      sizen: "16 4.2",
      style: MANIACONTROL_STYLES.backgroundStyle,
      substyle: MANIACONTROL_STYLES.cardSubstyle,
      action: options.searchAction
    }),
    label({
      posn: "20 4.9 3",
      textcolor: MANIACONTROL_STYLES.primaryTextColor,
      textsize: "1.02",
      textemboss: "1",
      text: "Search",
      action: options.searchAction
    }),
    label({
      posn: "-38 0.8 2",
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
    const rowY = -5 - index * 5.6;
    return [
      quad({
        posn: `0 ${rowY} 1`,
        sizen: "78 4.4",
        style: MANIACONTROL_STYLES.backgroundStyle,
        substyle: index % 2 === 0
          ? MANIACONTROL_STYLES.cardSubstyle
          : MANIACONTROL_STYLES.alternateCardSubstyle
      }),
      label({
        posn: `-36 ${rowY - 1.1} 2`,
        sizen: "44 3",
        halign: "left",
        textcolor: MANIACONTROL_STYLES.primaryTextColor,
        textsize: "0.95",
        textemboss: "1",
        text: row.left
      }),
      label({
        posn: `10 ${rowY - 1.1} 2`,
        sizen: "13 3",
        halign: "left",
        textcolor: MANIACONTROL_STYLES.accentTextColor,
        textsize: "0.88",
        textemboss: "1",
        text: row.right
      }),
      ...(row.action
        ? [
            quad({
              posn: `28 ${rowY - 0.5} 2`,
              sizen: "10 3.2",
              style: MANIACONTROL_STYLES.backgroundStyle,
              substyle: MANIACONTROL_STYLES.cardSubstyle,
              action: row.action
            }),
            label({
              posn: `29.4 ${rowY - 1.15} 3`,
              sizen: "8 2.5",
              textcolor: MANIACONTROL_STYLES.primaryTextColor,
              textsize: "0.8",
              textemboss: "1",
              text: row.actionLabel ?? "Action",
              action: row.action
            })
          ]
        : [])
    ];
  });
}
