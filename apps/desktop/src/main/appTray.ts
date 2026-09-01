import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {app, Menu, Tray, nativeImage} from 'electron';
import {mainI18n} from './i18n';

/** `apps/desktop/build/icon.png` — from `out/main` in electron-vite. */
export function unpackagedIcon(): string | undefined {
	if (app.isPackaged) return undefined;
	const p = join(__dirname, '../../build/icon.png');
	return existsSync(p) ? p : undefined;
}

let tray: Tray | null = null;

function trayImage() {
	if (process.platform === 'darwin') {
		try {
			const named = nativeImage.createFromNamedImage('NSActionTemplate', [18, 18]);
			if (!named.isEmpty()) {
				named.setTemplateImage(true);
				return named;
			}
		} catch {
			/* fall through */
		}
	}
	return nativeImage.createEmpty();
}

function trayMenu(handlers: {showMain: () => void; quit: () => void}) {
	const t = mainI18n().t.bind(mainI18n());
	return Menu.buildFromTemplate([
		{label: t('shell.tray.open'), click: () => handlers.showMain()},
		{type: 'separator'},
		{label: t('shell.tray.quit'), click: () => handlers.quit()}
	]);
}

export function ensureAppTray(handlers: {
	showMain: () => void;
	quit: () => void;
}): void {
	if (tray) {
		tray.setContextMenu(trayMenu(handlers));
		return;
	}
	tray = new Tray(trayImage());
	tray.setToolTip('Fast');
	tray.setContextMenu(trayMenu(handlers));
	tray.on('click', () => handlers.showMain());
	tray.on('double-click', () => handlers.showMain());
}

export function destroyAppTray(): void {
	if (!tray) return;
	tray.destroy();
	tray = null;
}

export function ensureDockVisible(): void {
	if (process.platform !== 'darwin') return;
	try {
		app.setName('Fast');
		const icon = unpackagedIcon();
		if (icon) app.dock?.setIcon(icon);
		app.dock?.show();
		app.setActivationPolicy('regular');
	} catch {
		/* ignore */
	}
}
