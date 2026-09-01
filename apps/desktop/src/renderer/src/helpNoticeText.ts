import type {TFunction} from 'i18next';

/** Resolve Host helpNotice: catalog key on the wire, else legacy bare message. */
export function helpNoticeText(
	notice: string | null | undefined,
	t: TFunction
): string {
	if (!notice) return '';
	if (notice.startsWith('errors.') || notice.startsWith('shell.')) return t(notice);
	return notice;
}
