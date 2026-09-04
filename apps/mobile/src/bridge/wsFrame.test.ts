import assert from 'node:assert/strict';
import {test} from 'node:test';

import {wsFrameText} from './wsFrame.ts';

test('wsFrameText keeps a JSON text frame', () => {
	assert.equal(wsFrameText('{"type":"HelloOk"}'), '{"type":"HelloOk"}');
});

test('wsFrameText decodes ArrayBuffer and Uint8Array frames', () => {
	const json = '{"type":"HelloOk","protocolVersion":1}';
	assert.equal(wsFrameText(new TextEncoder().encode(json).buffer), json);
	assert.equal(wsFrameText(new TextEncoder().encode(json)), json);
});

test('wsFrameText ignores unknown payloads', () => {
	assert.equal(wsFrameText(null), null);
	assert.equal(wsFrameText(1), null);
});
