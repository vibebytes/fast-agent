export type EditDraft = {name: string; baseUrl: string; credential: string};

/** Probe detail is operator-visible — keep HTTP codes (the dialog used to drop them). */
export function providerStatusNote(detail: string | null | undefined): string | null {
	const text = detail?.trim();
	return text || null;
}

export function editTestUpsert(
	id: string,
	current: {name: string; vendor: string; baseUrl?: string | null},
	draft: EditDraft
): {id: string; name: string; presetKey: string; baseUrl: string; credential?: string} | null {
	const name = draft.name || current.name;
	const dirty =
		Boolean(draft.credential) || name !== current.name || draft.baseUrl !== (current.baseUrl ?? '');
	if (!dirty) return null;
	return {
		id,
		name,
		presetKey: current.vendor,
		baseUrl: draft.baseUrl,
		...(draft.credential ? {credential: draft.credential} : {})
	};
}
