/**
 * Alternate-buffer capability gate. Enter/leave is owned by Ink
 * (`alternateBuffer` / `setOptions({isAlternateBufferEnabled})`); this module
 * only answers whether fullscreen mode is allowed in the current environment.
 */
export function alternateScreenAllowed(): boolean {
	if (process.env['FAST_DISABLE_ALTERNATE_SCREEN'] === '1') return false;
	if (process.env['FAST_SCREEN_READER'] === '1') return false;
	if (!process.stdout.isTTY) return false;
	if ((process.env['TERM'] ?? '') === 'dumb') return false;
	return true;
}
