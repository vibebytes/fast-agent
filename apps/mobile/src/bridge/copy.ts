export type Copy =
  | { code: 'urlScheme' }
  | { code: 'urlInvalid' }
  | { code: 'tlsModuleMissing' }
  | { code: 'tlsModuleError'; message: string }
  | { code: 'confirmFingerprint'; fingerprint?: string }
  | { code: 'cannotConnect' }
  | { code: 'timeout' }
  | { code: 'helloOk' }
  | { code: 'helloReject'; message?: string }
  | { code: 'raw'; text: string };

export type Translate = (key: string, opts?: Record<string, string | number>) => string;

export function formatCopy(t: Translate, copy: Copy): string {
  switch (copy.code) {
    case 'raw':
      return copy.text;
    case 'helloReject':
      return copy.message?.trim() || t('mobile.copy.helloReject');
    case 'tlsModuleError':
      return t('mobile.copy.tlsModuleError', { message: copy.message });
    case 'confirmFingerprint':
      return copy.fingerprint
        ? t('mobile.pairing.confirmFingerprint', { fingerprint: copy.fingerprint })
        : t('mobile.pairing.confirmFingerprintShort');
    default:
      return t(`mobile.copy.${copy.code}`);
  }
}

export function rawError(error: unknown): Copy {
  return error instanceof Error && error.message.trim()
    ? { code: 'raw', text: error.message }
    : { code: 'cannotConnect' };
}
