import { entry, frame, label, quad } from "./manialink.js";

type NodeLike =
  | ReturnType<typeof frame>
  | ReturnType<typeof label>
  | ReturnType<typeof quad>
  | ReturnType<typeof entry>;

export interface PanelRow {
  left: string;
  right: string;
}

export interface StatusRow {
  label: string;
  value: string;
}

export function buildSidebarButton(text: string, action: string): NodeLike[] {
  return [
    quad({
      sizen: "8 8",
      style: "Bgs1InRace",
      substyle: "BgTitleShadow",
      action
    }),
    label({
      posn: "0 -0.3 2",
      sizen: "7 3",
      style: "TextTitle1",
      textcolor: "fff",
      text: text,
      textsize: "1.05",
      textemboss: "1",
      action
    }),
    quad({
      posn: "0 -4.7 1",
      sizen: "8 0.6",
      bgcolor: "08bf"
    })
  ];
}

export function buildMainPanelShell(
  title: string,
  closeAction: string,
  children: NodeLike[],
  posn = "0 35 20",
  size = "120 42"
): ReturnType<typeof frame> {
  return frame(
    {
      posn
    },
    [
      quad({
        sizen: size,
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
        text: title
      }),
      quad({
        posn: "56 17 2",
        sizen: "5 5",
        bgcolor: "a22d",
        action: closeAction
      }),
      label({
        posn: "57.4 15.9 3",
        textcolor: "fff",
        textsize: "1.2",
        textemboss: "1",
        text: "X",
        action: closeAction
      }),
      ...children
    ]
  );
}

export function buildSearchSection(
  entryName: string,
  defaultValue: string,
  searchAction: string,
  statusText: string,
  statusColor: string
): NodeLike[] {
  return [
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
      name: entryName,
      default: defaultValue,
      textsize: "1",
      style: "TextValueSmall"
    }),
    quad({
      posn: "26 5 2",
      sizen: "16 4",
      style: "Bgs1InRace",
      substyle: "BgCard1",
      action: searchAction
    }),
    label({
      posn: "29 4 3",
      textcolor: "fff",
      textsize: "1",
      textemboss: "1",
      text: "Search",
      action: searchAction
    }),
    label({
      posn: "-55 0 2",
      halign: "left",
      textsize: "0.9",
      textcolor: statusColor,
      textemboss: "1",
      text: statusText
    })
  ];
}

export function buildPanelRows(
  rows: Array<PanelRow & { action?: string }>
): NodeLike[] {
  return rows.flatMap((row, index) => {
    const rowY = 6.5 - index * 6;
    const action = row.action;
    return [
      quad({
        posn: `0 ${rowY} 1`,
        sizen: "112 5",
        style: "Bgs1InRace",
        substyle: index % 2 === 0 ? "BgCard1" : "BgCard"
      }),
      label({
        posn: `-52 ${rowY - 1.3} 2`,
        sizen: "66 3.5",
        halign: "left",
        textcolor: "fff",
        textsize: "1",
        textemboss: "1",
        text: row.left
      }),
      label({
        posn: `20 ${rowY - 1.3} 2`,
        sizen: "18 3.5",
        halign: "left",
        textcolor: "7fd",
        textsize: "0.95",
        textemboss: "1",
        text: row.right
      }),
      ...(action
        ? [
            quad({
              posn: `44 ${rowY - 0.7} 2`,
              sizen: "14 3.8",
              style: "Bgs1InRace",
              substyle: "BgCard1",
              action
            }),
            label({
              posn: `46 ${rowY - 1.4} 3`,
              sizen: "10 3",
              textcolor: "fff",
              textsize: "0.9",
              textemboss: "1",
              text: "Import",
              action
            })
          ]
        : [])
    ];
  });
}

export function buildStatusWidget(
  title: string,
  rows: StatusRow[],
  footer: string,
  posn = "140 85 5",
  size = "48 12.5"
): ReturnType<typeof frame> {
  return frame(
    {
      posn
    },
    [
      quad({
        posn: "0 0 0",
        sizen: size,
        halign: "right",
        valign: "top",
        style: "Bgs1InRace",
        substyle: "BgTitleShadow"
      }),
      label({
        posn: "-43 -1.1 2",
        sizen: "24 2.5",
        halign: "left",
        style: "TextTitle1",
        textcolor: "fff",
        textsize: "1.1",
        textemboss: "1",
        text: title
      }),
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
    ]
  );
}
