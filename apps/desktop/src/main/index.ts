import {app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, shell} from 'electron';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {
	InvokeChannel,
	InvokeChannels,
	PushChannel,
	PushChannels,
	UiSend
} from '@fast-ide/session-view';
import {WorkspaceHub} from './bridge/WorkspaceHub';
import {MobileBridgeServer} from './bridge/MobileBridgeServer';
import {createDesktopHost} from './bridge/desktopHost';
import {isDefaultProjectPath} from './bridge/defaultProject';
import {createUiPublisher} from './bridge/uiPublisher';
import {createSystemNotifier} from './notify/systemNotifier';
import {
	initialWorkspaceRestoreState,
	reduceWorkspaceRestore,
	type WorkspaceRestoreCommand,
	type WorkspaceRestoreState
} from './bridge/workspaceRestore';
import {
	destroyAppTray,
	ensureAppTray,
	ensureDockVisible,
	unpackagedIcon
} from './appTray';
import {
	applyLocalePref,
	asLocalePref,
	loadLocalePref,
	mainI18n,
	saveLocalePref
} from './i18n';
import {
	destroyPetWindow,
	hasPetWindow,
	initPetFromPrefs,
	isPetVisible,
	loadPetVisible,
	movePetWindow,
	persistPetPosition,
	setPetVisible
} from './petWindow';
import {
	mimeTypeForImagePath,
	readProjectMedia,
	resolveInsideProject
} from './fs/listProjectDir';
import {applyPackagedRuntime} from './packagedRuntime';
import {applyRuntimeEnv} from './runtimeEnv';
import {
	LOCAL_EDGE_ID,
	commitActiveId,
	edgesPath,
	loadEdgesFile,
	remoteConnection,
	saveEdgesFile,
	type TokenVault
} from './remoteEdges';

/** Serve project images without shipping multi‑MB base64 over IPC. */
protocol.registerSchemesAsPrivileged([
	{
		scheme: 'fast-ide-media',
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
			stream: true,
			bypassCSP: true
		}
	}
]);

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const electronVault: TokenVault = {
	isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
	encryptString: plain => safeStorage.encryptString(plain),
	decryptString: buf => safeStorage.decryptString(buf)
};

function persistCommittedEdge(id: string): void {
	const filePath = edgesPath(app.getPath('userData'));
	saveEdgesFile(filePath, commitActiveId(loadEdgesFile(filePath), id));
	pushEdgesChanged();
}

const hub = new WorkspaceHub({
	persistActiveId: persistCommittedEdge
});
const mobileBridge = new MobileBridgeServer({
	port: Number(process.env.FAST_MOBILE_BRIDGE_PORT ?? 8787),
	token: process.env.FAST_MOBILE_BRIDGE_TOKEN ?? '',
	send: command => hub.getBridge()?.send(command) ?? false,
	log: message => console.log(`[mobile-bridge] ${message}`)
});
let heartbeatTimer: NodeJS.Timeout | null = null;
let restoreState: WorkspaceRestoreState = initialWorkspaceRestoreState();
let restoreTimeoutTimer: NodeJS.Timeout | null = null;

/** Shell chrome pushes — suppressed until cold-start restore completes (landing gate). */
const SHELL_PUSH = new Set<PushChannel>([
	'projects:changed',
	'workspace:focus',
	'project:changed',
	'tasks:changed',
	'transcript:patched',
	'transcript:tailPatched'
]);

function activeFsRoot(): string | null {
	const active = hub.getActive();
	if (!active) return null;
	return active.cwd ?? active.path;
}

function createWindow(): void {
	const isMac = process.platform === 'darwin';
	const isWin = process.platform === 'win32';
	const bootBg = nativeTheme.shouldUseDarkColors ? '#09090b' : '#fafafa';
	const bootFg = nativeTheme.shouldUseDarkColors ? '#fafafa' : '#18181b';

	const windowIcon = unpackagedIcon();
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 840,
		title: 'Fast',
		show: false,
		backgroundColor: bootBg,
		...(windowIcon ? {icon: windowIcon} : {}),
		...(isMac
			? {
					titleBarStyle: 'hiddenInset' as const,
					trafficLightPosition: {x: 14, y: 12}
				}
			: isWin
				? {
						titleBarOverlay: {
							color: bootBg,
							symbolColor: bootFg,
							height: 40
						}
					}
				: {}),
		webPreferences: {
			preload: join(__dirname, '../preload/index.mjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			autoplayPolicy: 'no-user-gesture-required'
		}
	});

	mainWindow.once('ready-to-show', () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.show();
		mainWindow.focus();
		if (process.platform === 'darwin') {
			app.focus({steal: true});
		}
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
	}

	mainWindow.on('close', event => {
		if (isQuitting) return;
		if (loadPetVisible() && (isPetVisible() || hasPetWindow())) {
			event.preventDefault();
			mainWindow?.hide();
			ensureDockVisible();
			installCompanionTray();
		}
	});

	mainWindow.on('closed', () => {
		stopHeartbeat();
		hub.closeAll();
		mainWindow = null;
	});
}

function quitApp(): void {
	isQuitting = true;
	app.quit();
}

function installCompanionTray(): void {
	ensureAppTray({
		showMain: () => showMainWindow(),
		quit: () => quitApp()
	});
}

function showMainWindow(): void {
	if (!mainWindow) {
		createWindow();
		beginWorkspaceRestore();
		// First paint: ready-to-show (static landing in index.html) — do not show blank.
	} else {
		mainWindow.show();
		mainWindow.focus();
		if (process.platform === 'darwin') {
			app.focus({steal: true});
		}
	}
	ensureDockVisible();
}

function runRestoreCommands(commands: WorkspaceRestoreCommand[]): void {
	for (const cmd of commands) {
		switch (cmd.type) {
			case 'ensureEngine': {
				const handlers = sharedProjectHandlers();
				if (!hub.isRemote()) hub.ensureDefaultProject(handlers);
				hub.ensureEngine(handlers);
				// No publishWorkspace — landing owns the first paint until restored/failed.
				break;
			}
			case 'armTimeout': {
				if (restoreTimeoutTimer) clearTimeout(restoreTimeoutTimer);
				restoreTimeoutTimer = setTimeout(() => {
					restoreTimeoutTimer = null;
					dispatchRestore({type: 'timeout'});
				}, cmd.ms);
				break;
			}
			case 'clearTimeout': {
				if (restoreTimeoutTimer) {
					clearTimeout(restoreTimeoutTimer);
					restoreTimeoutTimer = null;
				}
				break;
			}
			case 'publishRestored': {
				// Meta proved the host is usable — drop sticky timeout error overlay.
				hub.recoverEngineHost();
				startHeartbeat();
				const publish = () => {
					publisher.publishWorkspace();
					publisher.publishFocusChange();
				};
				publish();
				sendToRenderer('workspace:restored', {});
				// Hello ListProviders often lands after this first paint. Await it so
				// Composer chrome is not stuck empty until the user opens the picker.
				void hub.refreshComposerCatalog().then(publish);
				break;
			}
			case 'publishFailed': {
				// Engine may already be ready while Meta is still slow; do not flip ready → error.
				if (hub.getEngineStatus().status !== 'ready') {
					hub.failEngine(cmd.reason);
				}
				startHeartbeat();
				publisher.publishWorkspace();
				publisher.publishFocusChange();
				sendToRenderer('workspace:restoreFailed', {reason: cmd.reason});
				break;
			}
		}
	}
}

function dispatchRestore(
	event: Parameters<typeof reduceWorkspaceRestore>[1]
): void {
	const next = reduceWorkspaceRestore(restoreState, event);
	restoreState = next.state;
	runRestoreCommands(next.commands);
}

function beginWorkspaceRestore(): void {
	dispatchRestore({type: 'start'});
}

function sendToRenderer<C extends PushChannel>(channel: C, payload: PushChannels[C]): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	const contents = mainWindow.webContents;
	if (!contents || contents.isDestroyed()) return;
	const frame = contents.mainFrame;
	if (!frame || frame.isDestroyed()) return;
	try {
		contents.send(channel, payload);
	} catch {
		// Ignore — Bridge may still stream while the UI remounts.
	}
}

const send: UiSend = (channel, payload) => {
	if (!restoreState.done && SHELL_PUSH.has(channel)) return;
	sendToRenderer(channel, payload);
};

function handleInvoke<C extends InvokeChannel>(
	channel: C,
	handler: (
		...args: InvokeChannels[C]['args']
	) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>
): void {
	ipcMain.handle(channel, (_event, ...args) =>
		handler(...(args as InvokeChannels[C]['args']))
	);
}

let activateTask: ((taskId: string) => void) | null = null;
const notifier = createSystemNotifier({onActivate: taskId => activateTask?.(taskId)});

const publisher = createUiPublisher({
	hub,
	send,
	notify: notifier
});

/** Mirror the General→Behavior「通知」toggle (Engine-side doc) into the main process. */
async function syncNotifyEnabled(): Promise<void> {
	const res = await hub.getSettings('global');
	if (!res.ok) return;
	const general = res.settings.find(d => d.namespace === 'general')?.payload;
	const raw = typeof general === 'object' && general !== null ? (general as {notifications?: unknown}).notifications : undefined;
	notifier.setEnabled(typeof raw === 'boolean' ? raw : true);
}

function stopHeartbeat(): void {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

function startHeartbeat(): void {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		hub.tickAllHeartbeats();
	}, 3000);
}

function sharedProjectHandlers() {
	return {
		onEvent(projectId: string, event: BridgeEvent) {
			mobileBridge.handleEvent(event);
			if (event.type === 'ready') {
				startHeartbeat();
				void syncNotifyEnabled();
			}
			if (event.type === 'settings_changed') {
				send('settings:changed', {
					scope: event.scope,
					scopeId: event.scopeId,
					namespace: event.namespace
				});
				void syncNotifyEnabled();
				return;
			}
			if (event.type === 'providers_changed') {
				send('providers:changed', {providerId: event.providerId});
				return;
			}
			if (event.type === 'skills_changed') {
				send('skills:changed', {skillName: event.skillName});
				return;
			}
			publisher.handleEvent(projectId, event);
			if (event.type === 'workspace_meta') {
				// Hub.applyWorkspaceMeta already opened/hydrated; seal restore + publish UI.
				dispatchRestore({type: 'metaApplied'});
			}
		},
		onError(
			projectId: string,
			message: string,
			meta?: {code?: string; params?: Record<string, string | number>}
		) {
			if (!restoreState.done) {
				dispatchRestore({
					type: 'engineFailed',
					message: message || meta?.code || 'engine error'
				});
				return;
			}
			publisher.handleError(projectId, message, meta);
		},
		onSessionsChanged() {
			// Hydrate storms (multi-project sessions_list) batch into one publish (P2-13).
			publisher.schedulePublishWorkspace();
		},
		onLog(projectId: string, message: string) {
			publisher.handleLog(projectId, message);
		},
		onExit(projectId: string, code: number | null, signal: NodeJS.Signals | null) {
			if (hub.getEngineStatus().status === 'reconnecting' || hub.getEngineStatus().status === 'exited') {
				stopHeartbeat();
			} else {
				startHeartbeat();
			}
			publisher.handleExit(projectId, code, signal);
		},
		onEngineStatus() {
			publisher.publishWorkspace();
			if (hub.getEngineStatus().status === 'ready') startHeartbeat();
		},
		onEngineInstallLog(log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) {
			sendToRenderer('engines:installLog', log);
		}
	};
}

function openProjectPath(workspaceRoot: string): void {
	if (isDefaultProjectPath(workspaceRoot)) {
		publisher.handleError('engine', 'Cannot open the hidden Default Project as a folder Project');
		return;
	}
	hub.openProject(workspaceRoot, sharedProjectHandlers());
	publisher.publishWorkspace();
	publisher.publishFocusChange();
	if (hub.getEngineStatus().status === 'ready') startHeartbeat();
}

const productInvokes = createDesktopHost({
	hub,
	publisher,
	getRestoreState: () => {
		if (restoreState.done) {
			publisher.publishWorkspace();
			publisher.publishFocusChange();
		}
		return restoreState;
	},
	startHeartbeat,
	stopHeartbeat,
	openProjectPath,
	projectHandlers: sharedProjectHandlers,
	pickDirectory: async () => {
		const result = await dialog.showOpenDialog({
			properties: ['openDirectory', 'createDirectory']
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0]!;
	},
	documentsDir: () => app.getPath('documents'),
	pathExists: existsSync,
	mkdirp: path => mkdirSync(path, {recursive: true}),
	showInFolder: path => shell.showItemInFolder(path),

	readMedia: readProjectMedia,
	vault: electronVault,
	userData: () => app.getPath('userData'),
	onEdgesChanged: () => pushEdgesChanged(),
	mobilePairing: () => mobileBridge.pairingInfo()
});

function pushEdgesChanged(): void {
	sendToRenderer('edges:changed', productInvokes['edges:list']());
}

function bindCommittedFromDisk(): void {
	const file = loadEdgesFile(edgesPath(app.getPath('userData')));
	if (file.activeId === LOCAL_EDGE_ID) return;
	const row = file.servers.find(s => s.id === file.activeId);
	if (!row) return;
	try {
		hub.bindCommittedEdge(row.id, remoteConnection(row, electronVault));
	} catch (error) {
		console.error('Failed to open stored edge token; staying on local', error);
	}
}

activateTask = (taskId: string) => {
	showMainWindow();
	void productInvokes['task:select'](taskId);
};

app.whenReady().then(async () => {
	applyPackagedRuntime({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
		env: process.env
	});
	applyRuntimeEnv({
		env: process.env,
		userDataPath: app.getPath('userData'),
		resourcesPath: process.resourcesPath,
		isPackaged: app.isPackaged
	});
	// Apply persisted locale before tray/pet menus so cold start matches pinned pref.
	await applyLocalePref(loadLocalePref());
	bindCommittedFromDisk();
	if (process.env.FAST_MOBILE_BRIDGE_TOKEN) {
		mobileBridge.start().catch(error => {
			console.error('[mobile-bridge] failed to start', error);
		});
	}

	protocol.handle('fast-ide-media', async request => {
		const root = activeFsRoot();
		if (!root) {
			return new Response('No project open', {status: 404});
		}
		try {
			const url = new URL(request.url);
			const requested =
				url.searchParams.get('p') ?? decodeURIComponent(url.pathname.replace(/^\//, ''));
			if (!requested?.trim()) {
				return new Response('Missing path', {status: 400});
			}
			const resolved = resolveInsideProject(root, requested);
			if (!resolved.ok) {
				return new Response(resolved.error, {status: 403});
			}
			const mime = mimeTypeForImagePath(resolved.target);
			if (!mime) {
				return new Response('Unsupported image type', {status: 415});
			}
			const response = await net.fetch(pathToFileURL(resolved.target).href);
			if (!response.ok) return response;
			const headers = new Headers(response.headers);
			headers.set('Content-Type', mime);
			headers.set('Cache-Control', 'no-cache');
			return new Response(response.body, {status: response.status, headers});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(message, {status: 500});
		}
	});

	for (const channel of Object.keys(productInvokes) as (keyof typeof productInvokes)[]) {
		// Correlated Record lookup loses arity; cast at the registration seam only.
		handleInvoke(channel, productInvokes[channel] as never);
	}

	handleInvoke('pet:getVisible', () => loadPetVisible());
	handleInvoke('pet:setVisible', (next: boolean) => {
		const applied = setPetVisible(Boolean(next));
		if (applied) {
			ensureDockVisible();
			installCompanionTray();
		} else if (
			mainWindow &&
			!mainWindow.isDestroyed() &&
			!mainWindow.isVisible()
		) {
			quitApp();
		} else {
			destroyAppTray();
		}
		return applied;
	});
	handleInvoke('locale:getSystem', () => app.getLocale());
	handleInvoke('locale:set', async (payload: {pref: string}) => {
		const pref = asLocalePref(payload?.pref);
		saveLocalePref(pref);
		await applyLocalePref(pref);
		if (loadPetVisible()) installCompanionTray();
		return true;
	});
	ipcMain.on('pet:activate', () => {
		showMainWindow();
	});
	ipcMain.on('pet:move', (_event, screenX: number, screenY: number) => {
		movePetWindow(Number(screenX) || 0, Number(screenY) || 0);
	});
	ipcMain.on('pet:persist-position', () => {
		persistPetPosition();
	});
	ipcMain.on('pet:context-menu', event => {
		const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
		const t = mainI18n().t.bind(mainI18n());
		const menu = Menu.buildFromTemplate([
			{
				label: t('shell.tray.open'),
				click: () => showMainWindow()
			},
			{type: 'separator'},
			{
				label: t('shell.tray.quit'),
				click: () => quitApp()
			}
		]);
		menu.popup({window: win});
	});

	app.setName('Fast');
	ensureDockVisible();

	createWindow();
	initPetFromPrefs();
	beginWorkspaceRestore();
	if (loadPetVisible()) {
		installCompanionTray();
	}

	app.on('activate', () => {
		showMainWindow();
		if (loadPetVisible()) setPetVisible(true);
	});
});

app.on('before-quit', () => {
	isQuitting = true;
	mobileBridge.stop();
	destroyAppTray();
	destroyPetWindow();
});

app.on('window-all-closed', () => {
	if (!isQuitting && (isPetVisible() || (loadPetVisible() && hasPetWindow()))) {
		return;
	}
	stopHeartbeat();
	hub.closeAll();
	destroyPetWindow();
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
