import {createHash} from 'node:crypto';
import tls from 'node:tls';

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function normalizeFingerprint(raw: string): string {
	const hex = raw.replace(/^sha256:/i, '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	if (hex.length !== 64) throw new Error('Invalid certificate fingerprint');
	return `sha256:${hex}`;
}

export function tryNormalizeFingerprint(raw: string): string | undefined {
	try {
		return normalizeFingerprint(raw);
	} catch {
		return undefined;
	}
}

export function displayFingerprint(fp: string): string {
	const hex = normalizeFingerprint(fp).slice(7).toUpperCase();
	return hex.match(/.{2}/g)!.join(':');
}

export function fingerprintOf(der: Buffer): string {
	return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

export type InspectTls = (
	url: string,
	timeoutMs?: number
) => Promise<{fingerprint: string; display: string}>;

/** TLS handshake only. No WebSocket, no Hello, no token. */
export async function inspectTls(
	url: string,
	timeoutMs = 8_000
): Promise<{fingerprint: string; display: string}> {
	const parsed = new URL(url);
	if (parsed.protocol !== 'wss:' && parsed.protocol !== 'https:') {
		throw new Error('Remote servers require TLS');
	}
	const host = parsed.hostname;
	const port = Number(parsed.port || 443);
	if (!host || !Number.isInteger(port) || port < 1) {
		throw new Error('Invalid TLS URL');
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};
		const sock = tls.connect(
			{
				host,
				port,
				rejectUnauthorized: false,
				timeout: timeoutMs,
				...(IPV4.test(host) ? {} : {servername: host})
			},
			() => {
				try {
					const cert = sock.getPeerCertificate();
					sock.destroy();
					if (!cert?.raw) {
						done(() => reject(new Error('Missing peer certificate')));
						return;
					}
					const fingerprint = fingerprintOf(cert.raw);
					done(() => resolve({fingerprint, display: displayFingerprint(fingerprint)}));
				} catch (err) {
					sock.destroy();
					done(() => reject(err instanceof Error ? err : new Error(String(err))));
				}
			}
		);
		sock.on('error', err => done(() => reject(err)));
		sock.on('timeout', () => {
			sock.destroy();
			done(() => reject(new Error('WebSocket connect timed out')));
		});
	});
}
