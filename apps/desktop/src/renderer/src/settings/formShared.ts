export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function namespacePayload(
	docs: {namespace: string; payload: unknown}[],
	namespace: string
): unknown {
	return docs.find(item => item.namespace === namespace)?.payload;
}
