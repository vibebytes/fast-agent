export function shouldEnableAppTray(platform: NodeJS.Platform, petVisible: boolean): boolean {
	return platform === 'darwin' || petVisible;
}

export function shouldHideMainWindowOnClose(
	platform: NodeJS.Platform,
	isQuitting: boolean,
	petCompanionActive: boolean
): boolean {
	return !isQuitting && (platform === 'darwin' || petCompanionActive);
}

export function ensureEnabledAppTray(
	platform: NodeJS.Platform,
	petVisible: boolean,
	installTray: () => void
): void {
	if (shouldEnableAppTray(platform, petVisible)) installTray();
}

export function handleMainWindowClose(
	event: {preventDefault: () => void},
	input: {
		platform: NodeJS.Platform;
		isQuitting: boolean;
		petCompanionActive: boolean;
		hide: () => void;
		ensureDock: () => void;
		installTray: () => void;
	}
): void {
	if (!shouldHideMainWindowOnClose(input.platform, input.isQuitting, input.petCompanionActive)) return;
	event.preventDefault();
	input.hide();
	input.ensureDock();
	input.installTray();
}

export function syncAppTrayAfterPetChange(
	platform: NodeJS.Platform,
	petVisible: boolean,
	handlers: {
		hidden: () => boolean;
		installTray: () => void;
		destroyTray: () => void;
		quit: () => void;
	}
): void {
	if (petVisible) {
		handlers.installTray();
		return;
	}
	if (shouldEnableAppTray(platform, false)) return;
	if (handlers.hidden()) {
		handlers.quit();
	} else {
		handlers.destroyTray();
	}
}
