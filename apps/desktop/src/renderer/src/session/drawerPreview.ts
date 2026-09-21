import {useEffect, useState} from 'react';
import {previewBodyLines} from './workPreview';
import {displayToolOutput} from '../toolPresentation';

export function formatElapsed(ms: number): string {
	const sec = Math.max(0, Math.floor(ms / 1000));
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

export function formatCountdown(ms: number): string {
	if (ms <= 0) return 'due';
	return `in ${formatElapsed(ms)}`;
}

export function useElapsedLabel(startedAt: number | undefined): string {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (startedAt == null) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [startedAt]);
	if (startedAt == null) return '';
	return formatElapsed(now - startedAt);
}

export function useCountdownLabel(nextFireAt: string | undefined, paused: boolean): string {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!nextFireAt || paused) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [nextFireAt, paused]);
	if (!nextFireAt || paused) return '';
	const t = Date.parse(nextFireAt);
	if (Number.isNaN(t)) return '';
	return formatCountdown(t - now);
}

/** Last few non-empty lines for proc preview (already plain command output). */
export function previewLines(raw: string | undefined, maxLines = 4): string {
	if (!raw) return '';
	return previewBodyLines(displayToolOutput(raw), maxLines);
}
