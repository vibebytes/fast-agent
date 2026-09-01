import manifest from './fileIconManifest.json';

export type FileIconManifest = {
	version: string;
	file: string;
	fileNames: Record<string, string>;
	fileExtensions: Record<string, string>;
	light: {
		file: string;
		fileNames: Record<string, string>;
		fileExtensions: Record<string, string>;
	};
};

const data = manifest as FileIconManifest;

/** Resolve Material icon id for a file basename (not a full path). */
export function fileIconId(fileName: string): string {
	const name = fileName.toLowerCase();
	const byName = data.fileNames[name];
	if (byName) return byName;
	const dot = name.lastIndexOf('.');
	if (dot > 0 && dot < name.length - 1) {
		const ext = name.slice(dot + 1);
		const byExt = data.fileExtensions[ext];
		if (byExt) return byExt;
	}
	return data.file;
}

export function fileIconSrc(fileName: string): string {
	const id = fileIconId(fileName);
	const base = import.meta.env.BASE_URL || './';
	return `${base}file-icons/${id}.svg`;
}
