import { i18n } from './setup';

/** Alert / event-handler path — do not call at module top level or in default params. */
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}
