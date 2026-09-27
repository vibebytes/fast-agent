export type ExperimentalDoc = {
	jevContext?: boolean;
	secretId?: string | null;
	last4?: string | null;
};

export type ExperimentalSave = {
	jevContext: boolean;
	secret?: string;
	clearSecret?: boolean;
};

export type ExperimentalView = {
	showSwitch: boolean;
	showKey: boolean;
	switchOn: boolean;
	last4: string | null;
	save: ExperimentalSave | null;
};

export function experimentalForm(input: {
	phaseActive: boolean;
	doc: ExperimentalDoc | null;
	draftOn: boolean;
	draftSecret: string;
	clear: boolean;
}): ExperimentalView {
	if (!input.phaseActive) {
		return {showSwitch: false, showKey: false, switchOn: false, last4: null, save: null};
	}
	const saved = Boolean(input.doc?.secretId);
	const last4 = saved ? (input.doc?.last4 ?? null) : null;
	const secret = input.draftSecret.trim();
	if (input.clear) {
		return {
			showSwitch: true,
			showKey: input.draftOn,
			switchOn: false,
			last4,
			save: {jevContext: false, clearSecret: true}
		};
	}
	if (input.draftOn && !saved && secret.length === 0) {
		return {showSwitch: true, showKey: true, switchOn: true, last4: null, save: null};
	}
	const save: ExperimentalSave = {jevContext: input.draftOn};
	if (secret.length > 0) save.secret = secret;
	return {showSwitch: true, showKey: input.draftOn, switchOn: input.draftOn, last4, save};
}
