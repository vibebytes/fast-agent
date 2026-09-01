import {useEffect, useRef, useState} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	LIVE_TICKER_LINE_HEIGHT_PX,
	LIVE_TICKER_ROWS,
	type TickerLine
} from './tickerTail';

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return false;
	}
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Props = {
	lines: TickerLine[];
	rows?: number;
	lineHeightPx?: number;
	className?: string;
};

/**
 * Fixed-height live window for open Thought / Exploring chrome.
 * New lines enter at the bottom; older lines roll up under a top fade mask.
 * Animation is host-local (not on TimelineItem props).
 */
export function LiveTicker({
	lines,
	rows = LIVE_TICKER_ROWS,
	lineHeightPx = LIVE_TICKER_LINE_HEIGHT_PX,
	className
}: Props) {
	const height = rows * lineHeightPx;
	const visible = lines.slice(-rows);
	const lastKey = visible.at(-1)?.key;
	const prevLastKey = useRef<number | undefined>(undefined);
	const [offsetY, setOffsetY] = useState(0);
	const [transition, setTransition] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return;
		}
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		const onChange = () => setReduceMotion(mq.matches);
		onChange();
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	useEffect(() => {
		if (reduceMotion || lastKey === undefined) {
			prevLastKey.current = lastKey;
			setOffsetY(0);
			setTransition(false);
			return;
		}
		const prev = prevLastKey.current;
		prevLastKey.current = lastKey;
		if (prev === undefined || lastKey <= prev) {
			setOffsetY(0);
			setTransition(false);
			return;
		}
		// Instantly park content one row down, then ease to 0 (new line enters from bottom).
		setTransition(false);
		setOffsetY(lineHeightPx);
		const id = requestAnimationFrame(() => {
			setTransition(true);
			setOffsetY(0);
		});
		return () => cancelAnimationFrame(id);
	}, [lastKey, lineHeightPx, reduceMotion]);

	return (
		<div
			data-live-ticker
			data-ticker-rows={rows}
			className={cn('relative mt-1.5 overflow-hidden', className)}
			style={{height}}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background to-transparent"
			/>
			<div
				className={cn(
					'border-l border-border/60 pl-3',
					transition && !reduceMotion && 'transition-transform duration-200 ease-out'
				)}
				style={{
					transform: reduceMotion ? undefined : `translateY(${offsetY}px)`
				}}
			>
				{visible.map(line => (
					<div
						key={line.key}
						className="truncate font-sans text-[12px] text-muted-foreground"
						style={{height: lineHeightPx, lineHeight: `${lineHeightPx}px`}}
					>
						{line.text}
					</div>
				))}
			</div>
		</div>
	);
}
