/**
 * Home/End are parsed by Ink's keypress parser but not exposed on Key.
 * Listen for the CSI sequences directly (composer caret + transcript scroll).
 */
import {useEffect, useRef} from 'react';

const HOME_RE = /\u001b(?:\[(?:1|7)~|OH|\[H)/g;
const END_RE = /\u001b(?:\[(?:4|8)~|OF|\[F)/g;

export function useHomeEndKeys(
	active: boolean,
	onHome: () => void,
	onEnd: () => void
): void {
	const homeRef = useRef(onHome);
	const endRef = useRef(onEnd);
	homeRef.current = onHome;
	endRef.current = onEnd;

	useEffect(() => {
		if (!active || process.stdin.isTTY !== true) return;

		const onData = (data: Buffer | string) => {
			const text = typeof data === 'string' ? data : data.toString('utf8');
			if (HOME_RE.test(text)) {
				HOME_RE.lastIndex = 0;
				homeRef.current();
			}
			if (END_RE.test(text)) {
				END_RE.lastIndex = 0;
				endRef.current();
			}
		};
		process.stdin.on('data', onData);
		return () => {
			process.stdin.off('data', onData);
		};
	}, [active]);
}
