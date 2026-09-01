export function flattenCatalog(obj: unknown, prefix = ''): Record<string, string> {
	if (typeof obj === 'string') {
		return prefix ? {[prefix]: obj} : {};
	}
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		Object.assign(out, flattenCatalog(value, path));
	}
	return out;
}
