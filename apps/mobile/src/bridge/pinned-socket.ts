import {EventEmitter, type EventSubscription, requireNativeModule} from 'expo-modules-core';

export type PinnedWire = {
  send: (text: string) => boolean;
  close: () => void;
};

type NativeEvents = {
  open: () => void;
  message: (event: {data?: string}) => void;
  error: () => void;
  close: () => void;
};

type Native = {
  connect: (url: string, fingerprint: string) => Promise<void>;
  send: (text: string) => boolean;
  disconnect: () => void;
};

type Handlers = {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onError: () => void;
  onClose: () => void;
};

function nativeModule(): Native {
  return requireNativeModule('FastBridgeTls') as Native;
}

export async function openPinnedSocket(url: string, fingerprint: string, handlers: Handlers): Promise<PinnedWire> {
  const native = nativeModule();
  const emitter = new EventEmitter<NativeEvents>(native as never);
  const subs: EventSubscription[] = [
    emitter.addListener('open', handlers.onOpen),
    emitter.addListener('message', (event: {data?: string}) => {
      if (typeof event?.data === 'string') handlers.onMessage(event.data);
    }),
    emitter.addListener('error', handlers.onError),
    emitter.addListener('close', handlers.onClose)
  ];
  try {
    await native.connect(url, fingerprint);
  } catch (error) {
    subs.forEach((s) => s.remove());
    throw error;
  }
  return {
    send: (text) => native.send(text),
    close: () => {
      subs.forEach((s) => s.remove());
      native.disconnect();
    }
  };
}