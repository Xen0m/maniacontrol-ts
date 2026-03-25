import type { Logger } from "pino";

import type { DedicatedClient } from "../transport/dedicated-client.js";

const DEFAULT_CHAT_PREFIX = "$<$z$ff0» ";

export class UIService {
  private readonly client: DedicatedClient;
  private readonly logger: Logger;

  public constructor(client: DedicatedClient, logger: Logger) {
    this.client = client;
    this.logger = logger.child({ component: "ui" });
  }

  public async sendInfo(message: string, recipients?: string[]): Promise<void> {
    await this.client.chatSendServerMessage(`${DEFAULT_CHAT_PREFIX}${message}$>`, recipients);
  }

  public async sendNotice(message: string, recipients?: string[]): Promise<void> {
    await this.client.sendNotice(message, recipients);
  }

  public async showWidget(xml: string, recipients?: string[]): Promise<void> {
    await this.client.sendDisplayManialinkPage(xml, recipients, 0, false);
  }

  public async hideWidget(recipients?: string[]): Promise<void> {
    await this.client.sendHideManialinkPage(recipients);
  }

  public logWidgetUpdate(widgetId: string): void {
    this.logger.debug({ widgetId }, "Widget updated");
  }
}
