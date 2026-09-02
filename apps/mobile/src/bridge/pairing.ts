import type { Copy } from './copy';

export type PairingPayload = {
  serverUrl: string;
  token: string;
  fingerprint: string | null;
};

/** Common mistype: `wws://` (OkHttp then redboxes). Also trim + lowercase scheme. */
export function normalizeBridgeUrl(raw: string): string {
  const text = raw.trim();
  const match = /^([a-zA-Z]+):\/\//.exec(text);
  if (!match) return text;
  const scheme = match[1].toLowerCase();
  const rest = text.slice(match[0].length);
  const mapped = scheme === 'wws' || scheme === 'wsss' ? 'wss' : scheme === 'https' ? 'wss' : scheme === 'http' ? 'ws' : scheme;
  return `${mapped}://${rest}`;
}

export function bridgeUrlIssue(url: string): Copy | null {
  if (!/^(ws|wss):\/\//i.test(url)) return { code: 'urlScheme' };
  try {
    // URL() only accepts http(s); map so we still catch host/port garbage.
    new URL(url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'));
  } catch {
    return { code: 'urlInvalid' };
  }
  return null;
}

export function parsePairingPayload(raw: string): PairingPayload | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const serverUrl = typeof obj.serverUrl === 'string' ? obj.serverUrl : typeof obj.url === 'string' ? obj.url : '';
      const token = typeof obj.token === 'string' ? obj.token : '';
      const fingerprint = typeof obj.fingerprint === 'string' ? obj.fingerprint : null;
      if (serverUrl) return {serverUrl, token, fingerprint};
    } catch {
      // fall through
    }
  }

  if (text.startsWith('fast-bridge://')) {
    try {
      const query = text.slice(text.indexOf('?') + 1);
      const params = new URLSearchParams(query);
      const serverUrl = params.get('url');
      const token = params.get('token');
      if (serverUrl) return {serverUrl, token: token ?? '', fingerprint: params.get('fingerprint')};
    } catch {
      // fall through
    }
  }

  const parts = text.split('|');
  if (parts.length >= 3 && parts[0] === 'fast-bridge') {
    return {serverUrl: parts[1], token: parts[2] ?? '', fingerprint: parts[3] || null};
  }

  if (/^(ws|wss):\/\//i.test(text)) {
    const urlMatch = /token=([^&\s]+)/i.exec(text);
    const fpMatch = /fingerprint=([^&\s]+)/i.exec(text);
    return {
      serverUrl: text,
      token: urlMatch ? decodeURIComponent(urlMatch[1]) : '',
      fingerprint: fpMatch ? decodeURIComponent(fpMatch[1]) : null
    };
  }

  return null;
}
