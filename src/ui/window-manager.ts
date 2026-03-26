import { frame, label, quad } from "./manialink.js";
import { MANIACONTROL_STYLES, WINDOW_DEFAULTS } from "./maniacontrol-style.js";

type WindowNode = ReturnType<typeof frame> | ReturnType<typeof label> | ReturnType<typeof quad>;

export interface WindowOptions {
  posn?: string;
  size?: string;
}

export function buildMainWindow(
  title: string,
  closeAction: string,
  children: WindowNode[],
  options: WindowOptions = {}
): ReturnType<typeof frame> {
  const posn = options.posn ?? WINDOW_DEFAULTS.main.posn;
  const size = options.size ?? WINDOW_DEFAULTS.main.size;

  return frame(
    {
      posn
    },
    [
      quad({
        sizen: size,
        style: MANIACONTROL_STYLES.backgroundStyle,
        substyle: MANIACONTROL_STYLES.backgroundSubstyle
      }),
      label({
        posn: "-55 17 2",
        sizen: "40 3",
        halign: "left",
        style: MANIACONTROL_STYLES.titleTextStyle,
        textcolor: MANIACONTROL_STYLES.primaryTextColor,
        textsize: "1.5",
        textemboss: "1",
        text: title
      }),
      buildCloseButton(closeAction),
      ...children
    ]
  );
}

export function buildStatusWindow(
  title: string,
  children: WindowNode[],
  options: WindowOptions = {}
): ReturnType<typeof frame> {
  const posn = options.posn ?? WINDOW_DEFAULTS.status.posn;
  const size = options.size ?? WINDOW_DEFAULTS.status.size;

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
        style: MANIACONTROL_STYLES.backgroundStyle,
        substyle: MANIACONTROL_STYLES.backgroundSubstyle
      }),
      label({
        posn: "-43 -1.1 2",
        sizen: "24 2.5",
        halign: "left",
        style: MANIACONTROL_STYLES.titleTextStyle,
        textcolor: MANIACONTROL_STYLES.primaryTextColor,
        textsize: "1.1",
        textemboss: "1",
        text: title
      }),
      ...children
    ]
  );
}

export function buildCloseButton(action: string): WindowNode {
  return frame(
    {},
    [
      quad({
        posn: "56 17 2",
        sizen: "5 5",
        bgcolor: MANIACONTROL_STYLES.closeColor,
        action
      }),
      label({
        posn: "57.4 15.9 3",
        textcolor: MANIACONTROL_STYLES.primaryTextColor,
        textsize: "1.2",
        textemboss: "1",
        text: "X",
        action
      })
    ]
  );
}
