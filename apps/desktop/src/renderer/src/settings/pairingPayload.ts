export function pairingPayload(p: {
	serverUrl: string;
	token: string;
	fingerprint?: string;
	trust?: 'public';
	serverKey?: string;
}): string {
	const url = encodeURIComponent(p.serverUrl);
	const token = encodeURIComponent(p.token);
	if (p.trust === 'public') {
		return `fast-bridge://pair?url=${url}&token=${token}&trust=public&serverKey=${encodeURIComponent(p.serverKey ?? '')}`;
	}
	return `fast-bridge://pair?url=${url}&token=${token}&fingerprint=${encodeURIComponent(p.fingerprint ?? '')}`;
}
