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

export interface ManialinkEntryValue {
  name: string;
  value: string;
}

export interface PlayerManialinkPageAnswerEvent extends DedicatedCallbackEvent {
  playerUid?: number;
  login?: string;
  answer?: string;
  entries: ManialinkEntryValue[];
}

export class CallbackBus extends EventEmitter {
  public dispatch(callback: XmlRpcCallMessage): void {
    const event = {
      method: callback.method,
      params: callback.params
    } satisfies DedicatedCallbackEvent;

    this.emit("callback", event);
    this.emit(callback.method, event);

    if (callback.method === "ManiaPlanet.PlayerManialinkPageAnswer") {
      const pageAnswerEvent = {
        method: callback.method,
        params: callback.params,
        playerUid: typeof callback.params[0] === "number" ? callback.params[0] : undefined,
        login: typeof callback.params[1] === "string" ? callback.params[1] : undefined,
        answer: typeof callback.params[2] === "string" ? callback.params[2] : undefined,
        entries: normalizeEntryValues(callback.params[3])
      } satisfies PlayerManialinkPageAnswerEvent;

      this.emit("manialink-answer", pageAnswerEvent);
      if (pageAnswerEvent.answer) {
        this.emit(`manialink-answer:${pageAnswerEvent.answer}`, pageAnswerEvent);
      }
    }

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

function normalizeEntryValues(payload: unknown): ManialinkEntryValue[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const name = typeof record.Name === "string" ? record.Name : typeof record.name === "string" ? record.name : undefined;
      const value = typeof record.Value === "string" ? record.Value : typeof record.value === "string" ? record.value : undefined;
      if (!name) {
        return null;
      }

      return {
        name,
        value: value ?? ""
      } satisfies ManialinkEntryValue;
    })
    .filter((entry): entry is ManialinkEntryValue => entry !== null);
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
