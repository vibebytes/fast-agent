import type { Copy } from './copy';
import { rawError } from './copy';

export type TlsProbe = {ok: true; fingerprint: string} | {ok: false; detail: Copy};

type NativeProbe = (url: string, expected: string | null) => Promise<string>;

let native: NativeProbe | null | undefined;
let loadError: string | null = null;

function nativeProbe(): NativeProbe | null {
  if (native !== undefined) return native;
  try {
    const {requireNativeModule} = require('expo-modules-core');
    const mod = requireNativeModule('FastBridgeTls') as {probe: NativeProbe};
    if (typeof mod?.probe !== 'function') throw new Error('FastBridgeTls.probe missing');
    native = (url, expected) => mod.probe(url, expected);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    native = null;
  }
  return native;
}

export function tlsProbeAvailable(): boolean {
  return nativeProbe() !== null;
}

export function isFingerprintMismatch(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as {code?: unknown}).code) : '';
  const text =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as {message?: unknown}).message)
        : String(error ?? '');
  return (
    code === 'ERR_FINGERPRINT_MISMATCH' ||
    /does not match pinned/i.test(text) ||
    text.includes('指纹不符')
  );
}

export async function probeTlsFingerprint(serverUrl: string, expected: string | null): Promise<TlsProbe> {
  if (!serverUrl.startsWith('wss://')) return {ok: true, fingerprint: ''};
  const probe = nativeProbe();
  if (!probe) {
    return {
      ok: false,
      detail: loadError
        ? { code: 'tlsModuleError', message: loadError }
        : { code: 'tlsModuleMissing' }
    };
  }
  try {
    const fingerprint = await probe(serverUrl.replace(/^wss:/, 'https:'), expected);
    return {ok: true, fingerprint};
  } catch (error) {
    if (isFingerprintMismatch(error)) {
      return {ok: false, detail: {code: 'raw', text: '指纹不符'}};
    }
    return {ok: false, detail: rawError(error)};
  }
}
