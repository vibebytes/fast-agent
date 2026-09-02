import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {bridgeEventSchema} from '@fastllm/bridge-protocol';

import type {ClientConfig} from './config';
import type { Copy } from './copy';
import { rawError } from './copy';
import {bridgeUrlIssue, normalizeBridgeUrl} from './pairing';
import {openPinnedSocket, type PinnedWire} from './pinned-socket';
import {probeTlsFingerprint} from './tls-pinning';

export type ConnectionState = 'idle' | 'connecting' | 'hello' | 'open' | 'closed' | 'rejected';

const HEARTBEAT_MS = 15_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

type Handlers = {
  onState: (state: ConnectionState, detail?: Copy) => void;
  onEvent: (event: BridgeEvent) => void;
  onOpen?: () => void;
  onUnpinnedFingerprint?: (fingerprint: string) => void;
};

type Wire = PinnedWire;

export class BridgeClient {
  private config: ClientConfig;
  private readonly handlers: Handlers;
  private wire: Wire | null = null;
  private opening = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;
  private state: ConnectionState = 'idle';

  constructor(config: ClientConfig, handlers: Handlers) {
    this.config = config;
    this.handlers = handlers;
  }

  updateConfig(config: ClientConfig) {
    this.config = config;
    this.close();
    this.disposed = false;
    this.connect();
  }

  connect() {
    if (this.disposed || this.wire || this.opening) return;
    this.setState('connecting');
    this.opening = true;
    void this.open().finally(() => {
      this.opening = false;
    });
  }

  private async open() {
    const serverUrl = normalizeBridgeUrl(this.config.serverUrl);
    const {fingerprint} = this.config;
    const issue = bridgeUrlIssue(serverUrl);
    if (issue) {
      this.setState('rejected', issue);
      return;
    }
    if (serverUrl.startsWith('wss://')) {
      const probe = await probeTlsFingerprint(serverUrl, fingerprint);
      if (this.disposed) return;
      if (!probe.ok) {
        this.setState('rejected', probe.detail);
        return;
      }
      if (!fingerprint) {
        this.handlers.onUnpinnedFingerprint?.(probe.fingerprint);
        this.setState('rejected', { code: 'confirmFingerprint' });
        return;
      }
      await this.openPinned(serverUrl, fingerprint);
      return;
    }
    if (this.disposed || this.wire) return;
    this.attachBrowserSocket(new WebSocket(serverUrl));
  }

  private async openPinned(serverUrl: string, fingerprint: string) {
    try {
      const wire = await openPinnedSocket(serverUrl, fingerprint, {
        onOpen: () => undefined,
        onMessage: (data) => this.onFrame(data),
        onError: () => this.scheduleReconnect(),
        onClose: () => {
          this.stopHeartbeat();
          if (this.wire) this.wire = null;
          if (this.state !== 'rejected') {
            this.setState('closed');
            this.scheduleReconnect();
          }
        }
      });
      if (this.disposed) {
        wire.close();
        return;
      }
      this.wire = wire;
      this.setState('hello');
      this.send({
        type: 'Hello',
        protocolVersion: 1,
        clientId: this.config.clientId,
        clientKind: 'fast-mobile',
        clientVersion: '0.1.0',
        authToken: this.config.token || undefined
      });
    } catch (error) {
      this.setState('closed', rawError(error));
      this.scheduleReconnect();
    }
  }

  private attachBrowserSocket(socket: WebSocket) {
    const wire: Wire = {
      send: (text) => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        socket.send(text);
        return true;
      },
      close: () => socket.close()
    };
    this.wire = wire;
    socket.onopen = () => {
      this.setState('hello');
      this.send({
        type: 'Hello',
        protocolVersion: 1,
        clientId: this.config.clientId,
        clientKind: 'fast-mobile',
        clientVersion: '0.1.0',
        authToken: this.config.token || undefined
      });
    };
    socket.onmessage = (raw) => {
      if (typeof raw.data === 'string') this.onFrame(raw.data);
    };
    socket.onerror = () => this.scheduleReconnect();
    socket.onclose = () => {
      this.stopHeartbeat();
      if (this.wire === wire) this.wire = null;
      if (this.state !== 'rejected') {
        this.setState('closed');
        this.scheduleReconnect();
      }
    };
  }

  private onFrame(data: string) {
    if (!data.startsWith('{')) return;
    let event: BridgeEvent;
    try {
      event = bridgeEventSchema.parse(JSON.parse(data));
    } catch {
      return;
    }
    if (event.type === 'HelloOk') {
      this.attempt = 0;
      this.setState('open');
      this.startHeartbeat();
      this.handlers.onOpen?.();
      return;
    }
    if (event.type === 'HelloReject') {
      this.setState(
        'rejected',
        event.message
          ? { code: 'raw', text: event.message }
          : event.code
            ? { code: 'raw', text: event.code }
            : { code: 'helloReject' }
      );
      this.close();
      return;
    }
    this.handlers.onEvent(event);
  }

  send(command: BridgeCommand): boolean {
    return this.wire?.send(JSON.stringify(command)) ?? false;
  }

  close() {
    this.disposed = true;
    this.opening = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.wire?.close();
    this.wire = null;
    this.setState('idle');
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({type: 'ClientHeartbeat', clientId: this.config.clientId, atMillis: Date.now()});
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer || this.state === 'rejected') return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setState(state: ConnectionState, detail?: Copy) {
    this.state = state;
    this.handlers.onState(state, detail);
  }
}
