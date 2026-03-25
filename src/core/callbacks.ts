import { EventEmitter } from "node:events";

import type { XmlRpcCallMessage } from "../xmlrpc/types.js";

export interface DedicatedCallbackEvent {
  method: string;
  params: unknown[];
}

export interface ScriptCallbackEvent extends DedicatedCallbackEvent {
  scriptMethod: string;
  payload: unknown;
}

export class CallbackBus extends EventEmitter {
  public dispatch(callback: XmlRpcCallMessage): void {
    const event = {
      method: callback.method,
      params: callback.params
    } satisfies DedicatedCallbackEvent;

    this.emit("callback", event);
    this.emit(callback.method, event);

    if (
      callback.method === "ManiaPlanet.ModeScriptCallback" ||
      callback.method === "ManiaPlanet.ModeScriptCallbackArray"
    ) {
      const scriptMethod = typeof callback.params[0] === "string" ? callback.params[0] : undefined;
      if (!scriptMethod) {
        return;
      }

      const rawPayload = callback.params[1];
      const payload = normalizeScriptPayload(rawPayload);
      const scriptEvent = {
        method: callback.method,
        params: callback.params,
        scriptMethod,
        payload
      } satisfies ScriptCallbackEvent;

      this.emit("script-callback", scriptEvent);
      this.emit(scriptMethod, scriptEvent);
    }
  }
}

function normalizeScriptPayload(payload: unknown): unknown {
  if (Array.isArray(payload) && payload.length === 1 && typeof payload[0] === "string") {
    return tryParseJson(payload[0]);
  }

  if (typeof payload === "string") {
    return tryParseJson(payload);
  }

  return payload;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
