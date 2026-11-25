import {join} from 'node:path';

export function resolveTrayIconPath(input: {
	isPackaged: boolean;
	resourcesPath: string;
	mainDir: string;
}): string {
	if (input.isPackaged) return join(input.resourcesPath, 'tray', 'trayTemplate.png');
	return join(input.mainDir, '../../build/trayTemplate.png');
}
