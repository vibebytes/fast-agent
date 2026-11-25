import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {resolveTrayIconPath} from './trayIcon.js';

const testDir = fileURLToPath(new URL('.', import.meta.url));

test('development uses the dedicated Fast tray template', () => {
	assert.equal(
		resolveTrayIconPath({
			isPackaged: false,
			resourcesPath: '/unused',
			mainDir: '/opt/Fast/out/main'
		}),
		'/opt/Fast/build/trayTemplate.png'
	);
});

test('packaged app loads the tray template from resources', () => {
	assert.equal(
		resolveTrayIconPath({
			isPackaged: true,
			resourcesPath: '/Applications/Fast.app/Contents/Resources',
			mainDir: '/unused'
		}),
		'/Applications/Fast.app/Contents/Resources/tray/trayTemplate.png'
	);
});

function pngSize(path: string): {width: number; height: number; colorType: number} {
	const bytes = readFileSync(path);
	assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
		colorType: bytes[25]
	};
}

test('tray templates ship 18pt and 2x RGBA assets', () => {
	const normal = pngSize(join(testDir, '../../build/trayTemplate.png'));
	const retina = pngSize(join(testDir, '../../build/trayTemplate@2x.png'));
	assert.deepEqual(normal, {width: 18, height: 18, colorType: 6});
	assert.deepEqual(retina, {width: 36, height: 36, colorType: 6});
});
