import {randomUUID} from 'node:crypto';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {inspectTls, type InspectTls} from './tlsPin.js';
import {connectWs, type RemoteBridgeConnectionOptions} from './wsConnection.js';

export type ProbeCode =
	| 'auth'
	| 'protocol'
	| 'tls'
	| 'plaintext'
	| 'timeout'
	| 'error'
	| 'confirm'
	| 'mismatch';

export type ProbeResult =
	| {ok: true; fingerprint?: string}
	| {ok: false; code: ProbeCode; message: string; fingerprint?: string; display?: string};

export function classifyProbeError(err: unknown): {code: ProbeCode; message: string} {
	const message = err instanceof Error ? err.message : String(err);
	const lower = message.toLowerCase();
	if (err instanceof Error && err.name === 'AbortError') return {code: 'timeout', message};
	if (lower.includes('timed out') || lower.includes('timeout')) return {code: 'timeout', message};
	if (lower.includes('fingerprint does not match')) return {code: 'mismatch', message};
	if (lower.includes('wrong_version_number') || lower.includes('wrong version number')) {
		return {code: 'plaintext', message: 'Server is speaking plaintext, not TLS'};
	}
	if (
		lower.includes('certificate') ||
		lower.includes('ssl') ||
		lower.includes('tls') ||
		lower.includes('self-signed') ||
		lower.includes('unable to verify')
	) {
		return {code: 'tls', message};
	}
	if (lower.includes('helloreject') && lower.includes('unauthorized')) {
		return {code: 'auth', message};
	}
	if (lower.includes('helloreject') && lower.includes('version')) {
		return {code: 'protocol', message};
	}
	return {code: 'error', message};
}

/** Temporary Hello/Goodbye on the same ws transport. Does not touch Hub. */
export async function probeBridge(
	opts: RemoteBridgeConnectionOptions,
	connect: typeof connectWs = connectWs,
	inspect: InspectTls = inspectTls
): Promise<ProbeResult> {
	const timeoutMs = opts.timeoutMs ?? 8_000;
	const started = Date.now();
	const needsPin =
		opts.url.startsWith('wss:') &&
		!opts.fingerprint?.trim() &&
		!opts.caPem?.trim() &&
		!opts.insecureSkipVerify;
	if (needsPin) {
		try {
			const seen = await inspect(opts.url, timeoutMs);
			return {
				ok: false,
				code: 'confirm',
				message: 'Confirm the server fingerprint',
				fingerprint: seen.fingerprint,
				display: seen.display
			};
		} catch (err) {
			return {ok: false, ...classifyProbeError(err)};
		}
	}
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	if (opts.signal) {
		if (opts.signal.aborted) ac.abort();
		else opts.signal.addEventListener('abort', () => ac.abort(), {once: true});
	}
	let hello: BridgeEvent | undefined;
	let poll: ReturnType<typeof setInterval> | undefined;
	try {
		const conn = await connect(
			opts.url,
			{
				onEvent: event => {
					if (event.type === 'HelloOk' || event.type === 'HelloReject') hello = event;
				},
				onError: () => {},
				onClose: () => {}
			},
			{
				caPem: opts.caPem,
				fingerprint: opts.fingerprint,
				insecureSkipVerify: opts.insecureSkipVerify,
				signal: ac.signal,
				timeoutMs: Math.max(1, timeoutMs - (Date.now() - started))
			}
		);
		const clientId = `fast-ide-probe-${randomUUID()}`;
		const remaining = Math.max(1, timeoutMs - (Date.now() - started));
		const ok = await new Promise<ProbeResult>((resolve, reject) => {
			const wait = setTimeout(() => reject(new Error('Hello timed out')), remaining);
			const settle = (fn: () => void) => {
				clearTimeout(wait);
				if (poll) clearInterval(poll);
				fn();
			};
			poll = setInterval(() => {
				if (!hello) return;
				if (hello.type === 'HelloOk') {
					settle(() => resolve({ok: true, fingerprint: opts.fingerprint?.trim()}));
				}
				else if (hello.type === 'HelloReject') {
					const reject = hello;
					const code: ProbeCode =
						reject.code === 'UNAUTHORIZED' ? 'auth' : reject.code === 'VERSION_MISMATCH' ? 'protocol' : 'error';
					settle(() => resolve({ok: false, code, message: reject.message ?? reject.code}));
				}
			}, 10);
			const sent = conn.send({
				type: 'Hello',
				protocolVersion: 1,
				clientId,
				clientKind: 'fast-ide',
				authToken: opts.authToken?.trim()
			});
			if (!sent) settle(() => reject(new Error('Failed to send Hello')));
		});
		try {
			conn.send({type: 'Goodbye', clientId, reason: 'probe'});
		} catch {
			// best effort
		}
		conn.close();
		return ok;
	} catch (err) {
		return {ok: false, ...classifyProbeError(err)};
	} finally {
		clearTimeout(timer);
		if (poll) clearInterval(poll);
	}
}
