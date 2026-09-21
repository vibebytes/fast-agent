export function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
	try {
		const value = localStorage.getItem(key);
		if (value && (allowed as readonly string[]).includes(value)) return value as T;
	} catch {
		// ignore
	}
	return fallback;
}

export function readStoredBool(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		if (value === 'true') return true;
		if (value === 'false') return false;
	} catch {
		// ignore
	}
	return fallback;
}
