export const RUN_MODES = ['agent', 'plan', 'ask', 'yolo', 'free'] as const;
export type RunModeName = (typeof RUN_MODES)[number];

export function isHighRiskRunMode(mode: RunModeName): boolean {
	return mode === 'free';
}

export function requiresRunModeConfirmation(
	currentMode: RunModeName,
	nextMode: RunModeName
): boolean {
	return isHighRiskRunMode(nextMode) && currentMode !== nextMode;
}

export function runModeRiskSuffixKey(
	mode: RunModeName
): 'shell.composer.freeModeRiskHint' | null {
	return isHighRiskRunMode(mode) ? 'shell.composer.freeModeRiskHint' : null;
}
