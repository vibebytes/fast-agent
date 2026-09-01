import {i18n} from './setup';

/** Non-React shell copy — same catalogs as `useTranslation()`. */
export function shellT(key: string, params?: Record<string, string | number>): string {
	return i18n.t(key, params);
}
