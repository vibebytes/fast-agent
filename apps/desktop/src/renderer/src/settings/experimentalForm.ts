export type ExperimentalDoc = {
	jevContext?: boolean;
	eachTurn?: boolean;
	secretId?: string | null;
	last4?: string | null;
};

export type ExperimentalSave = {
	jevContext: boolean;
	eachTurn: boolean;
	secret?: string;
	clearSecret?: boolean;
};

export type ExperimentalView = {
	showSwitch: boolean;
	showEachTurn: boolean;
	showKey: boolean;
	switchOn: boolean;
	eachTurnOn: boolean;
	last4: string | null;
	save: ExperimentalSave | null;
};

export function experimentalForm(input: {
	phaseActive: boolean;
	doc: ExperimentalDoc | null;
	draftOn: boolean;
	draftEachTurn: boolean;
	draftSecret: string;
	clear: boolean;
}): ExperimentalView {
	if (!input.phaseActive) {
		return {
			showSwitch: false,
			showEachTurn: false,
			showKey: false,
			switchOn: false,
			eachTurnOn: false,
			last4: null,
			save: null
		};
	}
	const saved = Boolean(input.doc?.secretId);
	const last4 = saved ? (input.doc?.last4 ?? null) : null;
	const secret = input.draftSecret.trim();
	const eachTurn = input.draftOn && input.draftEachTurn;
	if (input.clear) {
		return {
			showSwitch: true,
			showEachTurn: false,
			showKey: input.draftOn,
			switchOn: false,
			eachTurnOn: false,
			last4,
			save: {jevContext: false, eachTurn: false, clearSecret: true}
		};
	}
	if (input.draftOn && !saved && secret.length === 0) {
		return {
			showSwitch: true,
			showEachTurn: true,
			showKey: true,
			switchOn: true,
			eachTurnOn: eachTurn,
			last4: null,
			save: null
		};
	}
	const save: ExperimentalSave = {jevContext: input.draftOn, eachTurn};
	if (secret.length > 0) save.secret = secret;
	return {
		showSwitch: true,
		showEachTurn: input.draftOn,
		showKey: input.draftOn,
		switchOn: input.draftOn,
		eachTurnOn: eachTurn,
		last4,
		save
	};
}
