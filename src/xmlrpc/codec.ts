import { XMLParser } from "fast-xml-parser";

import type { XmlRpcFault, XmlRpcMessage, XmlRpcValue } from "./types.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false
});

const DATE_FORMAT = /^\d{8}T\d{2}:\d{2}:\d{2}$/;

export function encodeRequest(method: string, params: XmlRpcValue[]): string {
  const encodedParams = params
    .map((param) => `<param><value>${encodeValue(param)}</value></param>`)
    .join("");

  return `<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${encodedParams}</params></methodCall>`;
}

export function decodeMessage(xml: string): XmlRpcMessage {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  if ("methodCall" in parsed) {
    const methodCall = parsed.methodCall as Record<string, unknown>;
    const paramsContainer = (methodCall.params ?? {}) as Record<string, unknown>;
    const rawParams = arrayify(paramsContainer.param);

    return {
      type: "call",
      method: String(methodCall.methodName),
      params: rawParams.map((param) => decodeValue((param as Record<string, unknown>).value))
    };
  }

  if (!("methodResponse" in parsed)) {
    throw new Error("Unsupported XML-RPC payload");
  }

  const methodResponse = parsed.methodResponse as Record<string, unknown>;

  if (methodResponse.fault) {
    const faultValue = decodeValue((methodResponse.fault as Record<string, unknown>).value) as unknown as XmlRpcFault;
    return {
      type: "fault",
      value: faultValue
    };
  }

  const paramsContainer = methodResponse.params as Record<string, unknown>;
  const param = arrayify(paramsContainer.param)[0] as Record<string, unknown> | undefined;

  return {
    type: "response",
    value: decodeValue(param?.value)
  };
}

function encodeValue(value: XmlRpcValue): string {
  if (value === null) {
    return "<string/>";
  }

  if (typeof value === "boolean") {
    return `<boolean>${value ? 1 : 0}</boolean>`;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? `<int>${value}</int>` : `<double>${value}</double>`;
  }

  if (typeof value === "string") {
    return value.length === 0 ? "<string/>" : `<string>${escapeXml(value)}</string>`;
  }

  if (value instanceof Date) {
    const iso8601 = value.toISOString().replace(/\.\d{3}Z$/, "").replace(/-/g, "").replace(/Z$/, "");
    return `<dateTime.iso8601>${iso8601}</dateTime.iso8601>`;
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => `<value>${encodeValue(item)}</value>`).join("");
    return `<array><data>${items}</data></array>`;
  }

  const members = Object.entries(value)
    .map(([key, memberValue]) => {
      return `<member><name>${escapeXml(key)}</name><value>${encodeValue(memberValue)}</value></member>`;
    })
    .join("");

  return `<struct>${members}</struct>`;
}

function decodeValue(rawValue: unknown): XmlRpcValue {
  if (rawValue === undefined || rawValue === null) {
    return "";
  }

  if (typeof rawValue !== "object") {
    return String(rawValue);
  }

  const valueObject = rawValue as Record<string, unknown>;

  if ("boolean" in valueObject) {
    return String(valueObject.boolean) === "1";
  }
  if ("int" in valueObject) {
    return Number.parseInt(String(valueObject.int), 10);
  }
  if ("i4" in valueObject) {
    return Number.parseInt(String(valueObject.i4), 10);
  }
  if ("double" in valueObject) {
    return Number.parseFloat(String(valueObject.double));
  }
  if ("string" in valueObject) {
    return String(valueObject.string ?? "");
  }
  if ("dateTime.iso8601" in valueObject) {
    const text = String(valueObject["dateTime.iso8601"]);
    if (DATE_FORMAT.test(text)) {
      const normalized = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9)}Z`;
      return new Date(normalized);
    }
    return text;
  }
  if ("array" in valueObject) {
    const arrayNode = valueObject.array as Record<string, unknown>;
    const dataNode = (arrayNode.data ?? {}) as Record<string, unknown>;
    return arrayify(dataNode.value).map((item) => decodeValue(item));
  }
  if ("struct" in valueObject) {
    const structNode = valueObject.struct as Record<string, unknown>;
    const result: Record<string, XmlRpcValue> = {};
    for (const member of arrayify(structNode.member)) {
      const memberObject = member as Record<string, unknown>;
      result[String(memberObject.name)] = decodeValue(memberObject.value);
    }
    return result;
  }

  return valueObject as { [key: string]: XmlRpcValue };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
