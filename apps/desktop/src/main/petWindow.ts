import {BrowserWindow, screen} from 'electron';
import {join} from 'node:path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {app} from 'electron';

const PET_SIZE = 112;
const PET_MARGIN = 28;

type PetPrefs = {
	visible?: boolean;
	x?: number;
	y?: number;
};

let petWindow: BrowserWindow | null = null;
let visible = false;

function prefsPath(): string {
	const dir = app.getPath('userData');
	if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
	return join(dir, 'pet.json');
}

function readPrefs(): PetPrefs {
	try {
		return JSON.parse(readFileSync(prefsPath(), 'utf8')) as PetPrefs;
	} catch {
		return {};
	}
}

function writePrefs(patch: PetPrefs): void {
	try {
		writeFileSync(prefsPath(), JSON.stringify({...readPrefs(), ...patch}, null, 2));
	} catch {
		/* ignore */
	}
}

export function loadPetVisible(): boolean {
	return readPrefs().visible === true;
}

function savePetVisible(next: boolean): void {
	writePrefs({visible: next});
	visible = next;
}

function defaultPetOrigin(): {x: number; y: number} {
	const area = screen.getPrimaryDisplay().workArea;
	return {
		x: Math.round(area.x + area.width - PET_SIZE - PET_MARGIN),
		y: Math.round(area.y + area.height - PET_SIZE - PET_MARGIN)
	};
}

function clampToWorkArea(x: number, y: number): {x: number; y: number} {
	const area = screen.getPrimaryDisplay().workArea;
	const minX = area.x;
	const minY = area.y;
	const maxX = area.x + area.width - PET_SIZE;
	const maxY = area.y + area.height - PET_SIZE;
	return {
		x: Math.min(maxX, Math.max(minX, Math.round(x))),
		y: Math.min(maxY, Math.max(minY, Math.round(y)))
	};
}

function placePet(win: BrowserWindow): void {
	const prefs = readPrefs();
	const fallback = defaultPetOrigin();
	const next = clampToWorkArea(
		typeof prefs.x === 'number' ? prefs.x : fallback.x,
		typeof prefs.y === 'number' ? prefs.y : fallback.y
	);
	win.setBounds({
		x: next.x,
		y: next.y,
		width: PET_SIZE,
		height: PET_SIZE
	});
}

function petPageUrl(): string {
	if (process.env.ELECTRON_RENDERER_URL) {
		return `${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '')}/pet.html`;
	}
	return join(__dirname, '../renderer/pet.html');
}

export function isPetVisible(): boolean {
	return visible && petWindow !== null && !petWindow.isDestroyed() && petWindow.isVisible();
}

export function hasPetWindow(): boolean {
	return petWindow !== null && !petWindow.isDestroyed();
}

export function createPetWindow(): BrowserWindow {
	if (petWindow && !petWindow.isDestroyed()) return petWindow;

	petWindow = new BrowserWindow({
		width: PET_SIZE,
		height: PET_SIZE,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		hasShadow: false,
		backgroundColor: '#00000000',
		title: 'Fast Pet',
		webPreferences: {
			preload: join(__dirname, '../preload/pet.mjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});

	placePet(petWindow);

	const url = petPageUrl();
	if (url.startsWith('http')) {
		void petWindow.loadURL(url);
	} else {
		void petWindow.loadFile(url);
	}

	petWindow.setAlwaysOnTop(true, 'floating');
	petWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});

	petWindow.on('closed', () => {
		petWindow = null;
	});

	return petWindow;
}

export function setPetVisible(next: boolean): boolean {
	savePetVisible(next);
	if (!next) {
		if (petWindow && !petWindow.isDestroyed()) {
			petWindow.hide();
		}
		return false;
	}

	const win = createPetWindow();
	placePet(win);
	if (!win.isVisible()) win.showInactive();
	return true;
}

export function movePetWindow(screenX: number, screenY: number): void {
	if (!petWindow || petWindow.isDestroyed()) return;
	const next = clampToWorkArea(screenX, screenY);
	petWindow.setPosition(next.x, next.y);
}

export function persistPetPosition(): void {
	if (!petWindow || petWindow.isDestroyed()) return;
	const [x, y] = petWindow.getPosition();
	writePrefs({x, y});
}

export function destroyPetWindow(): void {
	if (petWindow && !petWindow.isDestroyed()) {
		persistPetPosition();
		petWindow.destroy();
	}
	petWindow = null;
}

export function initPetFromPrefs(): void {
	visible = loadPetVisible();
	if (visible) {
		setPetVisible(true);
	}
}
