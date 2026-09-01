import {useEffect} from 'react';
import {playCompletionSound, unlockCompletionSound} from './completionSound';
import {settingsStore, useSettings} from './settings/useSettings';

/** Load general settings at boot and play the completion chime when the host cues. */
export function useCompletionSound(engineReady: boolean): void {
	useSettings(engineReady);
	useEffect(() => {
		const unlock = () => {
			void unlockCompletionSound();
		};
		window.addEventListener('pointerdown', unlock, {once: true});
		const subscribe = window.fastIde.onCompletionCue;
		// Preload does not HMR — a live renderer can outrun an old BrowserWindow preload.
		if (typeof subscribe !== 'function') {
			return () => window.removeEventListener('pointerdown', unlock);
		}
		const off = subscribe(() => {
			if (settingsStore.getSnapshot().general.soundPrompt) void playCompletionSound();
		});
		return () => {
			window.removeEventListener('pointerdown', unlock);
			off();
		};
	}, []);
}
