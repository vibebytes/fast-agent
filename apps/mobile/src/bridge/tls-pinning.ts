export type TlsProbe = {ok: true; fingerprint: string} | {ok: false; detail: string};

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

export async function probeTlsFingerprint(serverUrl: string, expected: string | null): Promise<TlsProbe> {
  if (!serverUrl.startsWith('wss://')) return {ok: true, fingerprint: ''};
  const probe = nativeProbe();
  if (!probe) {
    return {
      ok: false,
      detail: loadError
        ? `TLS 指纹模块不可用：${loadError}`
        : 'TLS指纹校验需要 Dev Client（当前壳没有 FastBridgeTls）'
    };
  }
  try {
    const fingerprint = await probe(serverUrl.replace(/^wss:/, 'https:'), expected);
    return {ok: true, fingerprint};
  } catch (error) {
    return {ok: false, detail: error instanceof Error ? error.message : String(error)};
  }
}
