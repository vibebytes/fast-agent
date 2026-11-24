export function initialHandledRequestNonce(
	defaultFilesOnOpen: boolean,
	requestNonce: number | undefined
): number | null {
	return defaultFilesOnOpen ? (requestNonce ?? null) : null;
}
