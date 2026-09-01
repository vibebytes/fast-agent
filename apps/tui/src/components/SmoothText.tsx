import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Text} from 'ink';
import {graphemes} from '../utils/textWidth.js';

type Props = {
	text: string;
	active?: boolean;
	speedMs?: number;
	burstChars?: number;
	color?: string;
	dimTail?: number;
};

// Typewriter animation needs a real interactive terminal; in pipes/tests/CI
// render the full text immediately (and keep zero timers alive).
const ANIMATION_SUPPORTED = process.stdout.isTTY === true && process.env['CI'] === undefined;

/**
 * Typewriter smoothing for streaming text. Advances by grapheme clusters,
 * never splitting surrogate pairs / ZWJ emoji / combining marks (slicing by
 * UTF-16 code units used to emit broken half-characters mid-stream).
 */
export function SmoothText({
	text,
	active = false,
	speedMs = 32,
	burstChars = 3,
	color,
	dimTail = 8
}: Props) {
	const animated = active && ANIMATION_SUPPORTED;
	const clusters = useMemo(() => (animated ? graphemes(text) : []), [animated, text]);
	const [visibleCount, setVisibleCount] = useState(0);
	const targetRef = useRef(clusters.length);
	targetRef.current = clusters.length;

	const wasAnimatedRef = useRef(animated);
	useEffect(() => {
		// On the non-animated -> animated transition the full text is already on
		// screen; reveal from there instead of replaying from zero. Plain text
		// changes must NOT setState here (a queued setState per streaming delta
		// trips React's nested-update limit under synchronous rerenders).
		if (animated && !wasAnimatedRef.current) {
			setVisibleCount(targetRef.current);
		}
		wasAnimatedRef.current = animated;
	}, [animated]);

	useEffect(() => {
		if (!animated) {
			return;
		}

		const timer = setInterval(() => {
			setVisibleCount(current => {
				const target = targetRef.current;
				if (current >= target) {
					return current;
				}
				const backlog = target - current;
				const step = Math.min(burstChars + Math.floor(backlog / 24), backlog);
				return current + step;
			});
		}, speedMs);
		// Never let the animation timer keep the process alive on its own.
		timer.unref?.();

		return () => clearInterval(timer);
	}, [animated, speedMs, burstChars]);

	if (!animated) {
		return <Text color={color}>{text}</Text>;
	}

	const shown = Math.min(visibleCount, clusters.length);
	if (shown === 0) {
		return <Text dimColor color={color}>▍</Text>;
	}

	const tailStart = Math.max(0, shown - dimTail);
	const stable = clusters.slice(0, tailStart).join('');
	const tail = clusters.slice(tailStart, shown).join('');

	return (
		<Text color={color}>
			{stable}
			{tail.length > 0 && <Text dimColor>{tail}</Text>}
			{shown < clusters.length && <Text dimColor>▍</Text>}
		</Text>
	);
}
