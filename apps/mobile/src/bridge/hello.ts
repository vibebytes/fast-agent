import type { Copy } from './copy';

/** Host always sends both `code` and `message`. Keep `code` typed so UNAUTHORIZED is reachable. */
export function helloRejectDetail(event: {code?: string; message?: string}): Copy {
  const code = event.code?.trim();
  if (code?.toUpperCase() === 'UNAUTHORIZED') return {code: 'unauthorized', message: event.message};
  if (code) return {code: 'rejectCode', reject: code, message: event.message};
  if (event.message?.trim()) return {code: 'raw', text: event.message};
  return {code: 'helloReject'};
}
