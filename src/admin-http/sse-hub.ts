import type { ServerResponse } from "node:http";

export interface AdminRealtimeEvent {
  type: string;
  data: unknown;
  emittedAt: string;
}

export class SseHub {
  private readonly clients = new Set<ServerResponse>();

  public addClient(response: ServerResponse): void {
    this.clients.add(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  public publish(type: string, data: unknown): void {
    const payload = {
      type,
      data,
      emittedAt: new Date().toISOString()
    } satisfies AdminRealtimeEvent;

    const message = [
      `event: ${type}`,
      `data: ${JSON.stringify(payload)}`,
      "",
      ""
    ].join("\n");

    for (const client of this.clients) {
      client.write(message);
    }
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public closeAll(): void {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}
