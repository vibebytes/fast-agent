import assert from 'node:assert/strict';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {encodeQrMatrix} from './qr.ts';

const zxingReader = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../../node_modules/.pnpm/zxing-wasm@3.1.3_@types+emscripten@1.41.5/node_modules/zxing-wasm/dist/es/reader/index.js'
);

function toImageData(matrix: boolean[][], scale = 8, quiet = 4) {
	const n = matrix.length;
	const size = (n + quiet * 2) * scale;
	const data = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const mx = Math.floor(x / scale) - quiet;
			const my = Math.floor(y / scale) - quiet;
			const dark = mx >= 0 && my >= 0 && mx < n && my < n && matrix[my][mx];
			const i = (y * size + x) * 4;
			const v = dark ? 0 : 255;
			data[i] = data[i + 1] = data[i + 2] = v;
			data[i + 3] = 255;
		}
	}
	return {data, width: size, height: size, colorSpace: 'srgb' as const};
}

async function decode(text: string): Promise<string[]> {
	const {readBarcodesFromImageData} = await import(zxingReader);
	const results = await readBarcodesFromImageData(toImageData(encodeQrMatrix(text)));
	return results.map((r: {text: string}) => r.text);
}

test('encodeQrMatrix is scannable for a short payload', async () => {
	assert.deepEqual(await decode('HELLO'), ['HELLO']);
});

test('encodeQrMatrix is scannable for a desktop pairing URL', async () => {
	const payload = `fast-bridge://pair?url=${encodeURIComponent('wss://192.168.1.8:1979/bridge')}&token=${encodeURIComponent('abcdefghijklmnopqrstuvwx012345')}&fingerprint=${encodeURIComponent('sha256:' + 'ab'.repeat(32))}`;
	assert.deepEqual(await decode(payload), [payload]);
});

test('encodeQrMatrix is scannable for version 7 payloads', async () => {
	const payload = 'A'.repeat(140);
	assert.deepEqual(await decode(payload), [payload]);
});
