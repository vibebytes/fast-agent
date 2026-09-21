import {useEffect} from 'react';
import {clampEffort} from '../effortClamp';
import type {ModelCatalogEntry} from '../env';

export async function persistModelSettings(
	platform: string,
	modelId: string,
	nextEffort?: string,
	nextThinking?: boolean
): Promise<void> {
	await window.fastIde.setModelSettings({
		platform,
		model: modelId,
		...(nextEffort ? {effort: nextEffort} : {}),
		...(nextThinking !== undefined ? {thinking: nextThinking} : {})
	});
}

export async function openModelPicker(args: {
	composerLocked: boolean;
	canChat: boolean;
	setModelSearch: (q: string) => void;
	setModelPopOpen: (open: boolean) => void;
}): Promise<void> {
	if (args.composerLocked || !args.canChat) return;
	args.setModelSearch('');
	args.setModelPopOpen(true);
	void window.fastIde.requestModelList();
}

/** Keep local effort/thinking in the model-supported envelope without writing On on mount. */
export function useEffortClamp(args: {
	activeModelEntry: ModelCatalogEntry | undefined;
	effort: string | undefined;
	setEffort: (next: string | undefined) => void;
	thinking: boolean;
	setThinking: (next: boolean) => void;
	supportedEfforts: string[];
	supportsThinking: boolean;
}): void {
	const {activeModelEntry, effort, setEffort, thinking, setThinking, supportedEfforts, supportsThinking} =
		args;
	useEffect(() => {
		if (!activeModelEntry) return;
		const next = clampEffort(effort, supportedEfforts, activeModelEntry.defaultEffort);
		if (next !== effort) setEffort(next);
		if (!supportsThinking && thinking) setThinking(false);
		// Do not SetModelSettings(true) on mount — races selectTask and can overwrite Off.
		// Wire default On lives in SessionController.submitThinking when sticky unset.
	}, [activeModelEntry, supportedEfforts, supportsThinking]); // eslint-disable-line react-hooks/exhaustive-deps
}
