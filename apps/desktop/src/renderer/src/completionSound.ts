/**
 * Short two-note chime for task completion. Synthesized so the repo stays asset-free.
 * Must resume the shared AudioContext before scheduling — Chromium starts suspended,
 * and gain ramps at exactly currentTime are dropped as "in the past" (silent chime).
 */
const LOOKAHEAD = 0.04;

export async function playCompletionSound(): Promise<void> {
	const AC = audioCtor();
	if (!AC) return;
	try {
		const ctx = await readyAudio(AC);
		const now = ctx.currentTime + LOOKAHEAD;
		tone(ctx, now, 880, 0.09);
		tone(ctx, now + 0.1, 1174.7, 0.12);
	} catch (err) {
		console.error('[completionSound]', err);
	}
}

/** Descending ping when an approval card appears — distinct from the completion chime. */
export async function playApprovalSound(): Promise<void> {
	const AC = audioCtor();
	if (!AC) return;
	try {
		const ctx = await readyAudio(AC);
		const now = ctx.currentTime + LOOKAHEAD;
		tone(ctx, now, 784, 0.1);
		tone(ctx, now + 0.12, 523.25, 0.14);
	} catch (err) {
		console.error('[approvalSound]', err);
	}
}

/** Prime the context on a user gesture so a later settle cue is not gated. */
export async function unlockCompletionSound(): Promise<void> {
	const AC = audioCtor();
	if (!AC) return;
	try {
		await readyAudio(AC);
	} catch (err) {
		console.error('[completionSound]', err);
	}
}

let shared: AudioContext | null = null;

export function resetCompletionSound(): void {
	if (shared) {
		try {
			void shared.close();
		} catch {
			/* mock / already closed */
		}
	}
	shared = null;
}

function audioCtor(): typeof AudioContext | undefined {
	return (
		window.AudioContext ??
		(window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
	);
}

async function readyAudio(AC: typeof AudioContext): Promise<AudioContext> {
	if (!shared || shared.state === 'closed') shared = new AC();
	if (shared.state !== 'running') await shared.resume();
	return shared;
}

function tone(ctx: AudioContext, at: number, freq: number, dur: number): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(freq, at);
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(0.18, at + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(at);
	osc.stop(at + dur + 0.02);
}
