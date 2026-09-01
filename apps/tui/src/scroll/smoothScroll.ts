/**
 * Smooth scroll helper. In tests (NODE_ENV=test) duration is forced to 0 so
 * other suites are not polluted by animation timers.
 */
export type SmoothScrollOptions = {
	from: number;
	to: number;
	max: number;
	durationMs?: number;
	onFrame: (scrollTop: number) => void;
};

const FRAME_MS = 33;

export function smoothScrollTo(options: SmoothScrollOptions): () => void {
	const duration = process.env['NODE_ENV'] === 'test' ? 0 : (options.durationMs ?? 200);
	const clampedTarget = Math.max(0, Math.min(options.max, options.to));

	if (duration === 0) {
		options.onFrame(clampedTarget);
		return () => undefined;
	}

	const start = Date.now();
	const from = Math.max(0, Math.min(options.from, options.max));
	const timer = setInterval(() => {
		const elapsed = Date.now() - start;
		const progress = Math.min(elapsed / duration, 1);
		const t = progress;
		const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
		const current = from + (clampedTarget - from) * ease;
		if (progress >= 1) {
			options.onFrame(Math.round(clampedTarget));
			clearInterval(timer);
		} else {
			options.onFrame(Math.round(current));
		}
	}, FRAME_MS);
	// Never let a scroll animation keep the process alive on its own.
	timer.unref?.();

	return () => clearInterval(timer);
}
