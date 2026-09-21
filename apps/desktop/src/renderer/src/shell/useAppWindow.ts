import type {EdgesList} from '@fast-ide/session-view';
import {useCallback, useEffect} from 'react';
import {useCommandPaletteShortcut} from '../commandPaletteShortcut';
import type {SettingsSectionId, SettingsSuite} from '../Settings2';

export function useAppWindow({
	engineKind,
	setSettings2Section,
	setSettings2Suite,
	setSettings2Open,
	setRemoteFolderOpen,
	setEdges,
	setCommandPaletteOpen
}: {
	engineKind: SettingsSuite;
	setSettings2Section: (section: SettingsSectionId) => void;
	setSettings2Suite: (suite: SettingsSuite) => void;
	setSettings2Open: (open: boolean) => void;
	setRemoteFolderOpen: (open: boolean) => void;
	setEdges: (edges: EdgesList) => void;
	setCommandPaletteOpen: (open: boolean) => void;
}): void {
	useCommandPaletteShortcut(
		useCallback(() => setCommandPaletteOpen(true), [setCommandPaletteOpen])
	);
	useEffect(() => {
		const onOpenSettings = (e: Event) => {
			const customEvent = e as CustomEvent<{section?: SettingsSectionId; suite?: SettingsSuite}>;
			if (customEvent.detail?.section) {
				setSettings2Section(customEvent.detail.section);
			}
			setSettings2Suite(customEvent.detail?.suite ?? engineKind);
			setSettings2Open(true);
		};
		window.addEventListener('fast-ide:open-settings', onOpenSettings);
		return () => window.removeEventListener('fast-ide:open-settings', onOpenSettings);
	}, [engineKind]);
	useEffect(() => {
		void window.fastIde.listEdges().then(setEdges);
		const off = window.fastIde.onEdgesChanged(setEdges);
		const onRemote = () => setRemoteFolderOpen(true);
		window.addEventListener('fast-ide:open-remote-folder', onRemote);
		return () => {
			off();
			window.removeEventListener('fast-ide:open-remote-folder', onRemote);
		};
	}, []);
}
