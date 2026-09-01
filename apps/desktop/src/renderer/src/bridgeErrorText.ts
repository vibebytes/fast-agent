import type {TFunction} from 'i18next';

/** Resolve sticky bridge banner: prefer catalog code, else legacy bare message. */
export function bridgeErrorText(
	err: {message: string; code?: string; params?: Record<string, string | number>} | null | undefined,
	t: TFunction
): string {
	if (!err) return '';
	if (!err.message && !err.code) return '';
	if (err.code) return t(`errors.${err.code}`, err.params);
	return err.message;
}
