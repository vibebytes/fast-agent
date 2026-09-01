/**
 * Bridge `command_result` names that must not become TUI transcript cards.
 * PascalCase → Machine/Host protocol ACKs (EnsureProject, BindSessionWorkspace, …).
 * User slash results (`skills`, `sessions`, …) stay in the chronological stream.
 */
export function isHostProtocolCommandResult(name: string | undefined): boolean {
	if (!name) return false;
	return /^[A-Z]/.test(name.trim());
}

/**
 * PascalCase host results that DO surface as transcript cards: Goal gate outcomes
 * the user must see (②′ card actions). CancelRun stays log-only — run_cancelled
 * already settles the turn and an ACK card would be redundant.
 */
const VISIBLE_HOST_RESULTS = new Set([
	'ConfirmGoal',
	'CancelGoal',
	'PatchGoal',
	'SteerGoal',
	'EscalateResume',
	'EscalateFail'
]);

/** Log-only: no `localTurns` command_result card. */
export function isSilentCommandResult(name: string | undefined): boolean {
	if (name && VISIBLE_HOST_RESULTS.has(name.trim())) return false;
	return isHostProtocolCommandResult(name);
}
