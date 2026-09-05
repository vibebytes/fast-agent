import {EventEmitter, type EventSubscription, requireNativeModule} from 'expo-modules-core';

import {NativeSocketEpoch} from './socket-epoch';

export type PinnedWire = {
  send: (text: string) => boolean;
  close: () => void;
};

const epoch = new NativeSocketEpoch();

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
  const lease = epoch.take();
  // Subscribe after connect so canceling the previous singleton does not
  // deliver its error/close to this caller (that was the test-connection failure).
  await native.connect(url, fingerprint);
  if (!lease.mine()) throw new Error('replaced');
  const emitter = new EventEmitter<NativeEvents>(native as never);
  const subs: EventSubscription[] = [
    emitter.addListener('open', handlers.onOpen),
    emitter.addListener('message', (event: {data?: string}) => {
      if (typeof event?.data === 'string' && lease.mine()) handlers.onMessage(event.data);
    }),
    emitter.addListener('error', () => {
      if (lease.mine()) handlers.onError();
    }),
    emitter.addListener('close', () => {
      if (lease.mine()) handlers.onClose();
    })
  ];
  return {
    send: (text) => (lease.mine() ? native.send(text) : false),
    close: () => {
      subs.forEach((s) => s.remove());
      lease.release(() => native.disconnect());
    }
  };
}