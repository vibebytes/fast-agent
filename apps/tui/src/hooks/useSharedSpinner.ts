/**
 * One global spinner clock shared by every animated indicator in the app.
 *
 * Previously each spinner ran its own setInterval; the unsynchronized timers
 * caused interleaved re-renders of the whole dynamic region (visible flicker).
 * A single ticker keeps all spinners in phase and produces at most one
 * re-render wave per frame.
 */
import {useEffect, useState} from 'react';
import {isScreenReader} from '../terminal/capabilityManager.js';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const SPINNER_INTERVAL_MS = 120;
/** Static stand-in when animation is disabled (screen readers). */
const STATIC_FRAME = '…';

type Listener = () => void;

let frameIndex = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	if (!timer) {
		timer = setInterval(() => {
			frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
			for (const entry of listeners) entry();
		}, SPINNER_INTERVAL_MS);
		// Never keep the process alive just for the spinner.
		timer.unref?.();
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};
}

/**
 * Current spinner frame, animated while `active` is true.
 * All consumers share one interval and tick in the same render batch.
 */
export function useSharedSpinner(active: boolean): string {
	const [, forceRender] = useState(0);
	// Screen readers: a churning braille char is pure noise — render a static
	// ellipsis and never subscribe to the animation clock.
	const animate = active && !isScreenReader();

	useEffect(() => {
		if (!animate) return;
		return subscribe(() => forceRender(value => value + 1));
	}, [animate]);

	if (!animate) return STATIC_FRAME;
	return SPINNER_FRAMES[frameIndex] ?? SPINNER_FRAMES[0]!;
}

/**
 * Frame plus tick index on the same shared clock — the index drives the
 * brand-gradient spinner color (`theme.spinner[index % length]`).
 */
export function useSharedSpinnerFrame(active: boolean): {frame: string; index: number} {
	const frame = useSharedSpinner(active);
	return {frame, index: frameIndex};
}
