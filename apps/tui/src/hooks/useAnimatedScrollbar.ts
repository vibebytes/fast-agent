/**
 * gemini-cli useAnimatedScrollbar: thumb stays near-invisible until scroll,
 * then fades in → holds → fades out. Colors come from our semantic theme.
 */
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useTheme} from '../contexts/ThemeContext.js';

const isTest = typeof process !== 'undefined' && process.env['NODE_ENV'] === 'test';

function parseHex(color: string): [number, number, number] | undefined {
	const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (!m) return undefined;
	const n = Number.parseInt(m[1]!, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Linear RGB blend for hex colors; falls back to `to` when either side is not hex. */
export function interpolateColor(from: string, to: string, t: number): string {
	const a = parseHex(from);
	const b = parseHex(to);
	if (!a || !b) return t < 1 ? from : to;
	const p = Math.max(0, Math.min(1, t));
	const ch = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * p);
	return `#${[ch(0), ch(1), ch(2)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export function useAnimatedScrollbar(
	isFocused: boolean,
	scrollBy: (delta: number) => void
): {
	scrollbarColor: string;
	flashScrollbar: () => void;
	scrollByWithAnimation: (delta: number) => void;
} {
	const {theme} = useTheme();
	// Idle thumb ≈ panel bg so it disappears; flash uses secondary text.
	const hidden = theme.background.panel;
	const visible = theme.text.secondary;
	const [scrollbarColor, setScrollbarColor] = useState(hidden);
	const colorRef = useRef(scrollbarColor);
	colorRef.current = scrollbarColor;
	const hiddenRef = useRef(hidden);
	const visibleRef = useRef(visible);
	hiddenRef.current = hidden;
	visibleRef.current = visible;

	const animationFrame = useRef<ReturnType<typeof setInterval> | null>(null);
	const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isAnimatingRef = useRef(false);

	const cleanup = useCallback(() => {
		isAnimatingRef.current = false;
		if (animationFrame.current) {
			clearInterval(animationFrame.current);
			animationFrame.current = null;
		}
		if (timeout.current) {
			clearTimeout(timeout.current);
			timeout.current = null;
		}
	}, []);

	// Theme switch: snap idle color without interrupting a flash mid-flight.
	useEffect(() => {
		if (!isAnimatingRef.current) setScrollbarColor(hidden);
	}, [hidden]);

	const flashScrollbar = useCallback(() => {
		cleanup();
		isAnimatingRef.current = true;

		const fadeInDuration = isTest ? 0 : 200;
		const visibleDuration = isTest ? 0 : 1000;
		const fadeOutDuration = isTest ? 0 : 300;
		const focusedColor = visibleRef.current;
		const unfocusedColor = hiddenRef.current;
		const startColor = colorRef.current;

		if (isTest) {
			setScrollbarColor(unfocusedColor);
			cleanup();
			return;
		}

		let start = Date.now();
		const animateFadeIn = () => {
			if (!isAnimatingRef.current) return;
			const progress = Math.max(0, Math.min((Date.now() - start) / fadeInDuration, 1));
			setScrollbarColor(interpolateColor(startColor, focusedColor, progress));
			if (progress < 1) return;
			if (animationFrame.current) {
				clearInterval(animationFrame.current);
				animationFrame.current = null;
			}
			timeout.current = setTimeout(() => {
				start = Date.now();
				const animateFadeOut = () => {
					if (!isAnimatingRef.current) return;
					const p = Math.max(0, Math.min((Date.now() - start) / fadeOutDuration, 1));
					setScrollbarColor(interpolateColor(focusedColor, unfocusedColor, p));
					if (p === 1) cleanup();
				};
				animationFrame.current = setInterval(animateFadeOut, 33);
			}, visibleDuration);
		};
		animationFrame.current = setInterval(animateFadeIn, 33);
	}, [cleanup]);

	const wasFocused = useRef(isFocused);
	useLayoutEffect(() => {
		if (isFocused && !wasFocused.current) {
			flashScrollbar();
		} else if (!isFocused && wasFocused.current) {
			cleanup();
			setScrollbarColor(hiddenRef.current);
		}
		wasFocused.current = isFocused;
		return cleanup;
	}, [isFocused, flashScrollbar, cleanup]);

	const scrollByWithAnimation = useCallback(
		(delta: number) => {
			scrollBy(delta);
			flashScrollbar();
		},
		[scrollBy, flashScrollbar]
	);

	return {scrollbarColor, flashScrollbar, scrollByWithAnimation};
}
