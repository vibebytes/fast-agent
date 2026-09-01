import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, it} from 'node:test';
import {isPathInsideRoot, listProjectDir, readProjectFile} from './listProjectDir.js';

describe('listProjectDir', () => {
	it('rejects paths outside the project root', () => {
		const root = path.resolve('/tmp/project');
		assert.equal(isPathInsideRoot(root, path.resolve('/tmp/other')), false);
		assert.equal(isPathInsideRoot(root, path.resolve(root, '..')), false);
		assert.equal(isPathInsideRoot(root, path.resolve(root, 'src')), true);
	});

	it('lists directories before files', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'fast-ide-fs-'));
		await mkdir(path.join(root, 'src'));
		await writeFile(path.join(root, 'README.md'), 'hi');
		const result = await listProjectDir(root, '');
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(
			result.entries.map(e => e.name),
			['src', 'README.md']
		);
	});

	it('reads a text file inside the project', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'fast-ide-fs-'));
		await writeFile(path.join(root, 'hello.txt'), 'hello world');
		const result = await readProjectFile(root, 'hello.txt');
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.content, 'hello world');
		assert.equal(result.relativePath, 'hello.txt');
	});

	it('reads an image as a data URL', async () => {
		const {readProjectMedia} = await import('./listProjectDir.js');
		const root = await mkdtemp(path.join(os.tmpdir(), 'fast-ide-fs-'));
		// Minimal 1x1 PNG
		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		);
		await mkdir(path.join(root, 'images'), {recursive: true});
		await writeFile(path.join(root, 'images', 'dot.png'), png);
		const result = await readProjectMedia(root, 'images/dot.png');
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.mimeType, 'image/png');
		assert.match(result.dataUrl, /^data:image\/png;base64,/);
	});

	it('resolves absolute and file:// paths inside the project', async () => {
		const {readProjectMedia, resolveInsideProject} = await import('./listProjectDir.js');
		const root = await mkdtemp(path.join(os.tmpdir(), 'fast-ide-fs-'));
		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		);
		await mkdir(path.join(root, 'images'), {recursive: true});
		const abs = path.join(root, 'images', 'dot.png');
		await writeFile(abs, png);

		const viaAbs = resolveInsideProject(root, abs);
		assert.equal(viaAbs.ok, true);
		if (viaAbs.ok) assert.equal(viaAbs.relativePath, 'images/dot.png');

		const viaFile = resolveInsideProject(root, pathToFileURL(abs).href);
		assert.equal(viaFile.ok, true);

		const media = await readProjectMedia(root, pathToFileURL(abs).href);
		assert.equal(media.ok, true);
	});
});
