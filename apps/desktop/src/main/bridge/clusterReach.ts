/** Whether a roster card can be opened. TLS inspect is separate; this only classifies. */
export type ClusterReach = 'open' | 'down' | 'mismatch' | 'no-main';

export type ClusterCard = {
	self?: boolean;
	endpoints?: string[];
	fingerprint?: string;
	mainSessionId?: string;
};

export function wssEndpoint(endpoints?: string[]): string | undefined {
	return endpoints?.find(item => item.startsWith('wss://'));
}

/**
 * `presented` is the certificate fingerprint from a TLS inspect (no Hello).
 * `null` means the inspect failed or was not attempted because there is no wss URL.
 */
export function clusterReach(card: ClusterCard, presented: string | null): {reach: ClusterReach; message?: string} {
	if (card.self) {
		return card.mainSessionId ? {reach: 'open'} : {reach: 'no-main', message: '没有主会话'};
	}
	const url = wssEndpoint(card.endpoints);
	if (!url || presented == null) return {reach: 'down', message: '不可连接'};
	if (!card.fingerprint || card.fingerprint !== presented) return {reach: 'mismatch', message: '指纹不符'};
	if (!card.mainSessionId) return {reach: 'no-main', message: '没有主会话'};
	return {reach: 'open'};
}
