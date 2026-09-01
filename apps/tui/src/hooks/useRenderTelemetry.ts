/**
 * Render-quality telemetry (gemini-cli ships slow-render telemetry; we surface
 * it locally in /debug). A "slow frame" is a commit where render-start →
 * effects-done exceeds the threshold; together with the flicker counter this
 * is the regression dashboard for the two failure modes that matter in a TUI.
 */
import {useEffect, useRef} from 'react';

let frameCount = 0;
let slowFrameCount = 0;
let worstFrameMs = 0;

export function getRenderTelemetry(): {frames: number; slowFrames: number; worstFrameMs: number} {
	return {frames: frameCount, slowFrames: slowFrameCount, worstFrameMs: Math.round(worstFrameMs)};
}

export function resetRenderTelemetry(): void {
	frameCount = 0;
	slowFrameCount = 0;
	worstFrameMs = 0;
}

export function useRenderTelemetry(thresholdMs = 200): void {
	const renderStartRef = useRef(0);
	renderStartRef.current = performance.now();

	useEffect(() => {
		const duration = performance.now() - renderStartRef.current;
		frameCount += 1;
		if (duration > worstFrameMs) worstFrameMs = duration;
		if (duration > thresholdMs) slowFrameCount += 1;
	});
}
