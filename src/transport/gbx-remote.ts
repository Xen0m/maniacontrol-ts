import { EventEmitter } from "node:events";
import net from "node:net";

import { decodeMessage, encodeRequest } from "../xmlrpc/codec.js";
import type { XmlRpcCallMessage, XmlRpcFaultMessage, XmlRpcResponseMessage, XmlRpcValue } from "../xmlrpc/types.js";

const HANDSHAKE_LENGTH = 15;
const GBX_PROTOCOL = "GBXRemote 2";
const REQUEST_HANDLE_START = 0x80000000;

interface PendingRequest {
  resolve: (value: XmlRpcValue) => void;
  reject: (error: Error) => void;
}

export class GbxRemoteClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly socket: net.Socket;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly callbacks: XmlRpcCallMessage[] = [];

  private buffer = Buffer.alloc(0);
  private lastHandle = REQUEST_HANDLE_START;
  private handshakeComplete = false;

  public constructor(host: string, port: number, timeoutMs: number) {
    super();
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.socket = new net.Socket();
  }

  public async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        this.socket.off("error", onError);
        this.socket.off("connect", onConnect);
      };

      this.socket.once("error", onError);
      this.socket.once("connect", onConnect);
      this.socket.connect(this.port, this.host);
    });

    this.socket.setNoDelay(true);
    this.socket.setTimeout(this.timeoutMs);
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processIncomingBuffer();
    });
    this.socket.on("error", (error) => {
      this.emit("error", error);
    });
    this.socket.on("close", () => {
      this.emit("close");
    });

    await this.waitForHandshake();
  }

  public close(): void {
    this.socket.destroy();
  }

  public async call(method: string, params: XmlRpcValue[] = []): Promise<XmlRpcValue> {
    const handle = this.nextHandle();
    const xml = encodeRequest(method, params);
    const frame = Buffer.alloc(8 + Buffer.byteLength(xml));
    frame.writeUInt32LE(Buffer.byteLength(xml), 0);
    frame.writeUInt32LE(handle, 4);
    frame.write(xml, 8);

    const result = new Promise<XmlRpcValue>((resolve, reject) => {
      this.pendingRequests.set(handle, { resolve, reject });
    });

    this.socket.write(frame);
    return result;
  }

  public drainCallbacks(): XmlRpcCallMessage[] {
    const callbacks = this.callbacks.slice();
    this.callbacks.length = 0;
    return callbacks;
  }

  private async waitForHandshake(): Promise<void> {
    if (this.handshakeComplete) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onHandshake = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        this.off("handshake", onHandshake);
        this.off("error", onError);
      };

      this.once("handshake", onHandshake);
      this.once("error", onError);
      this.processIncomingBuffer();
    });
  }

  private processIncomingBuffer(): void {
    if (!this.handshakeComplete) {
      if (this.buffer.length < HANDSHAKE_LENGTH) {
        return;
      }

      const size = this.buffer.readUInt32LE(0);
      const protocol = this.buffer.subarray(4, HANDSHAKE_LENGTH).toString("utf8");
      this.buffer = this.buffer.subarray(HANDSHAKE_LENGTH);

      if (size !== 11 || protocol !== GBX_PROTOCOL) {
        const error = new Error(`Unexpected GBX handshake: size=${size} protocol=${protocol}`);
        this.emit("error", error);
        return;
      }

      this.handshakeComplete = true;
      this.emit("handshake");
    }

    while (this.buffer.length >= 8) {
      const payloadSize = this.buffer.readUInt32LE(0);
      const handle = this.buffer.readUInt32LE(4);
      const totalFrameLength = 8 + payloadSize;

      if (this.buffer.length < totalFrameLength) {
        return;
      }

      const xml = this.buffer.subarray(8, totalFrameLength).toString("utf8");
      this.buffer = this.buffer.subarray(totalFrameLength);

      const message = decodeMessage(xml);
      if (message.type === "call") {
        this.callbacks.push(message);
        this.emit("callback", message);
        continue;
      }

      const pending = this.pendingRequests.get(handle);
      if (!pending) {
        continue;
      }

      this.pendingRequests.delete(handle);

      if (message.type === "fault") {
        pending.reject(new Error(formatFault(message)));
      } else {
        pending.resolve((message as XmlRpcResponseMessage).value);
      }
    }
  }

  private nextHandle(): number {
    if (this.lastHandle === 0xffffffff) {
      this.lastHandle = REQUEST_HANDLE_START;
    } else {
      this.lastHandle += 1;
    }
    return this.lastHandle;
  }
}

function formatFault(message: XmlRpcFaultMessage): string {
  return `XML-RPC fault ${message.value.faultCode}: ${message.value.faultString}`;
}
