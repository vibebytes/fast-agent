export function diffModelPaths(instanceId: string): {
	originalModelPath: string;
	modifiedModelPath: string;
} {
	const id = instanceId.replace(/[^A-Za-z0-9_-]/g, '_');
	return {
		originalModelPath: `inmemory://diff/${id}/original`,
		modifiedModelPath: `inmemory://diff/${id}/modified`
	};
}
