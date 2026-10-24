import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCsp, injectCsp, parseUiCsp} from './csp';
import {mountMessage, prepareDocument} from './mount';

test('parseUiCsp keeps domains and swallows junk', () => {
	const csp = parseUiCsp({
		connectDomains: ['https://api.example', 'javascript:alert(1)', 'https://*.example', 5],
		resourceDomains: ['blob:'],
		frameDomains: 'nope'
	});
	assert.deepEqual(csp?.connectDomains, ['https://api.example', 'https://*.example']);
	assert.deepEqual(csp?.resourceDomains, ['blob:']);
	assert.deepEqual(csp?.frameDomains, []);
	assert.equal(parseUiCsp(null), null);
});

test('buildCsp denies by default and opens only declared directives', () => {
	const closed = buildCsp(parseUiCsp({}));
	assert.match(closed, /default-src 'none'/);
	assert.doesNotMatch(closed, /connect-src/);
	assert.match(closed, /base-uri 'none'/);

	const open = buildCsp(parseUiCsp({connectDomains: ['wss://api.example'], baseUriDomains: ['https://a.example']}));
	assert.match(open, /connect-src wss:\/\/api\.example/);
	assert.match(open, /base-uri https:\/\/a\.example/);
});

test('injectCsp puts the policy first inside head, after a doctype if present', () => {
	const withHead = injectCsp('<html><head><script>1</script></head></html>', "default-src 'none'");
	assert.ok(withHead.indexOf('Content-Security-Policy') < withHead.indexOf('<script>'));

	const withDoctype = injectCsp('<!doctype html><html><body>x</body></html>', "default-src 'none'");
	assert.ok(withDoctype.startsWith('<!doctype html><head><meta http-equiv="Content-Security-Policy"'));

	const bare = injectCsp('<p>x</p>', "default-src 'none'");
	assert.ok(bare.startsWith('<meta http-equiv="Content-Security-Policy"'));
});

test('mountMessage carries the injected document, not the raw one', () => {
	const html = '<html><head></head><body>app</body></html>';
	const msg = mountMessage(html, {connectDomains: ['https://api.example']}, 'App');
	assert.equal(msg.kind, 'relay.mount');
	assert.ok(msg.document.includes('connect-src https://api.example'));
	assert.ok(msg.document.includes('body>app'));
	assert.equal(msg.title, 'App');
});

test('prepareDocument reports the sanitised policy it applied', () => {
	const prepared = prepareDocument('<html></html>', {frameDomains: ['javascript:']});
	assert.deepEqual(prepared.csp?.frameDomains, []);
	assert.doesNotMatch(prepared.document, /frame-src/);
});
