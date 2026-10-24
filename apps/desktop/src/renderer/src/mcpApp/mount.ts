import {buildCsp, injectCsp, parseUiCsp, type UiCsp} from './csp';
import type {RelayIn} from './protocol';

export type PreparedDocument = {document: string; csp: UiCsp | null};

/** Server HTML → the document the relay hands to the sandboxed frame. Policy goes in before any script. */
export function prepareDocument(html: string, csp: Record<string, unknown> | undefined): PreparedDocument {
	const ui = parseUiCsp(csp);
	return {document: injectCsp(html, buildCsp(ui)), csp: ui};
}

export function mountMessage(
	html: string,
	csp: Record<string, unknown> | undefined,
	title: string
): RelayIn {
	return {kind: 'relay.mount', document: prepareDocument(html, csp).document, title};
}
