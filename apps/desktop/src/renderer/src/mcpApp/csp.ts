/** `_meta.ui.csp` as declared by the server; every field is optional. */
export type UiCsp = {
	connectDomains?: string[];
	resourceDomains?: string[];
	frameDomains?: string[];
	baseUriDomains?: string[];
};

const FIELDS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'] as const;

/** `https://a.example`, `https://*.example`, `https:` — nothing that could end the directive. */
const SOURCE = /^(https?|wss?|data|blob):$|^(https?|wss?):\/\/[a-z0-9.*:-]+$/i;

function clean(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	const out: string[] = [];
	for (const raw of list) {
		if (typeof raw !== 'string') continue;
		const value = raw.trim();
		if (!value || value.length > 200 || !SOURCE.test(value)) continue;
		out.push(value);
	}
	return [...new Set(out)];
}

export function parseUiCsp(meta: unknown): UiCsp | null {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
	const src = meta as Record<string, unknown>;
	const csp: UiCsp = {};
	for (const field of FIELDS) csp[field] = clean(src[field]);
	return csp;
}

/**
 * The inner document is opaque-origin, so `'self'` is useless: scripts and styles must be inline.
 * Anything not declared stays denied — including network.
 */
export function buildCsp(csp: UiCsp | null): string {
	const remote = [...(csp?.resourceDomains ?? []), ...(csp?.connectDomains ?? [])];
	const parts = [
		"default-src 'none'",
		"script-src 'unsafe-inline'",
		"style-src 'unsafe-inline'",
		`img-src data: blob:${remote.length ? ` ${remote.join(' ')}` : ''}`,
		`media-src data: blob:${remote.length ? ` ${remote.join(' ')}` : ''}`,
		`font-src data:${remote.length ? ` ${remote.join(' ')}` : ''}`
	];
	if (csp?.connectDomains?.length) parts.push(`connect-src ${csp.connectDomains.join(' ')}`);
	if (csp?.frameDomains?.length) parts.push(`frame-src ${csp.frameDomains.join(' ')}`);
	parts.push(`base-uri ${csp?.baseUriDomains?.length ? csp.baseUriDomains.join(' ') : "'none'"}`);
	parts.push("form-action 'none'");
	return parts.join('; ');
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** iframe `csp` is unreliable; the policy has to be the first thing the parser sees inside the document. */
export function injectCsp(html: string, policy: string): string {
	const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}">`;
	const head = /<head(\s[^>]*)?>/i.exec(html);
	if (head) {
		const at = head.index + head[0].length;
		return html.slice(0, at) + meta + html.slice(at);
	}
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	if (doctype) {
		const at = doctype[0].length;
		return `${html.slice(0, at)}<head>${meta}</head>${html.slice(at)}`;
	}
	return `${meta}${html}`;
}

/** Opaque origin + no `allow-same-origin`: storage APIs throw, but the relay cannot be rewritten. */
export const INNER_SANDBOX = 'allow-scripts';
