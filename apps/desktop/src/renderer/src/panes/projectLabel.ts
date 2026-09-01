import {shellT as t} from '../i18n/t';

/** Human label for Meta project id — never dump raw UUID as primary text. */
export function projectLabel(
	projectId: string | null | undefined,
	known?: string | null
): string {
	const named = known?.trim();
	if (named && !looksLikeId(named)) return named;
	const id = projectId?.trim() || '';
	if (!id || id === '_unknown') return t('shell.projectLabel.ungrouped');
	if (!looksLikeId(id)) return id;
	return t('shell.projectLabel.short', {id: id.slice(0, 8)});
}

function looksLikeId(s: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
