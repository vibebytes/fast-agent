import {useEffect} from 'react';

/**
 * Global ⌘K / Ctrl+K opener — lives outside CommandPalette.tsx so App's static
 * import of the hook does not pull the palette into the entry chunk (P1-9).
 */
export function useCommandPaletteShortcut(onOpen: () => void): void {
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				onOpen();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onOpen]);
}
