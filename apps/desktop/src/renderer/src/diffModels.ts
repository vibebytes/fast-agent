export function createDiffModels<T>(
	factory: (value: string, language: string) => T,
	original: string,
	modified: string,
	language: string
): {original: T; modified: T} {
	return {
		original: factory(original, language),
		modified: factory(modified, language)
	};
}
