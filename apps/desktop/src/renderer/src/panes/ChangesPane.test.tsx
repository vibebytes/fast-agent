import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ChangesPane} from './ChangesPane';
import {GitDiffPane} from './GitDiffPane';
import type {GitFileDiffResult, GitStatus} from '@fast-ide/session-view';

function setup(diff: GitFileDiffResult) {
	const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url: 'http://localhost/'});
	const g = globalThis as Record<string, unknown>;
	g.window = dom.window;
	g.document = dom.window.document;
	Object.defineProperty(g, 'navigator', {value: dom.window.navigator, configurable: true});
	for (const key of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'MouseEvent']) {
		g[key] = (dom.window as unknown as Record<string, unknown>)[key];
	}
	g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	g.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: Array<[string, string, boolean | undefined]> = [];
	(dom.window as unknown as Record<string, unknown>).fastIde = {
		gitFileDiff: async (repoPath: string, relativePath: string, includeHunks?: boolean) => {
			calls.push([repoPath, relativePath, includeHunks]);
			return diff;
		}
	};
	const container = dom.window.document.getElementById('root')!;
	const root = createRoot(container);
	return {dom, root, container, calls};
}

const status: GitStatus = {
	branch: 'main',
	dirty: true,
	files: [{path: 'a.txt', kind: 'modified'}],
	repos: [
		{path: '', name: 'root-repo', branch: 'main', files: [{path: 'a.txt', kind: 'modified'}]},
		{path: 'nested', name: 'nested-repo', branch: 'dev', files: [{path: 'b.txt', kind: 'added'}]}
	]
};

test('file rows open Git diff tabs without fetching inline diffs', async () => {
	const env = setup({ok: true, file: null});
	const opened: Array<[string, string]> = [];
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenDiff={(repo, path) => opened.push([repo, path])} />);
	});
	assert.match(env.container.textContent ?? '', /root-repo/);
	assert.match(env.container.textContent ?? '', /nested-repo/);
	const toggle = env.container.querySelector('[data-testid="git-change-:a.txt"]')!;
	await act(async () => {
		toggle.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
	});
	assert.deepEqual(opened, [['', 'a.txt']]);
	assert.deepEqual(env.calls, []);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('nested repository rows preserve the repository path', async () => {
	const env = setup({ok: true, file: null});
	const opened: Array<[string, string]> = [];
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenDiff={(repo, path) => opened.push([repo, path])} />);
	});
	const open = env.container.querySelector('[data-testid="git-open-nested:b.txt"]')!;
	await act(async () => {
		open.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
	});
	assert.deepEqual(opened, [['nested', 'b.txt']]);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('repository groups collapse and expand without losing files', async () => {
	const env = setup({ok: true, file: null});
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenDiff={() => {}} />);
	});
	const header = env.container.querySelector('[data-testid="git-repo-nested"]')!;
	assert.ok(env.container.querySelector('[data-testid="git-change-nested:b.txt"]'));
	await act(async () => {
		header.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
	});
	assert.equal(header.getAttribute('aria-expanded'), 'false');
	assert.equal(env.container.querySelector('[data-testid="git-change-nested:b.txt"]'), null);
	await act(async () => {
		header.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
	});
	assert.equal(header.getAttribute('aria-expanded'), 'true');
	assert.ok(env.container.querySelector('[data-testid="git-change-nested:b.txt"]'));
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('Git diff tab requests hunks and renders binary and truncated states', async () => {
	const tab = {id: 'git', kind: 'diff' as const, title: 'a.txt', repoPath: 'nested', filePath: 'a.txt'};
	const binaryEnv = setup({
		ok: true,
		file: {path: 'a.txt', additions: 0, deletions: 0, hunks: [], binary: true}
	});
	await act(async () => {
		binaryEnv.root.render(<GitDiffPane tab={tab} />);
		await Promise.resolve();
	});
	assert.deepEqual(binaryEnv.calls, [['nested', 'a.txt', true]]);
	assert.match(binaryEnv.container.textContent ?? '', /shell\.changes\.scmBinary/);
	await act(async () => binaryEnv.root.unmount());
	binaryEnv.dom.window.close();

	const truncatedEnv = setup({
		ok: true,
		file: {path: 'a.txt', additions: 0, deletions: 0, hunks: [], truncated: true}
	});
	await act(async () => {
		truncatedEnv.root.render(<GitDiffPane tab={tab} />);
		await Promise.resolve();
	});
	assert.match(truncatedEnv.container.textContent ?? '', /shell\.changes\.scmTruncated/);
	await act(async () => truncatedEnv.root.unmount());
	truncatedEnv.dom.window.close();
});

test('Git diff tab renders daemon hunks directly when available', async () => {
	const env = setup({
		ok: true,
		file: {
			path: '.gitignore',
			additions: 1,
			deletions: 1,
			hunks: [{header: '@@ -1 +1 @@', lines: ['-old', '+new']}],
			original: 'old',
			modified: 'new'
		}
	});
	const tab = {id: 'git', kind: 'diff' as const, title: '.gitignore', repoPath: 'site', filePath: '.gitignore'};
	await act(async () => {
		env.root.render(<GitDiffPane tab={tab} />);
		await Promise.resolve();
	});
	assert.deepEqual(env.calls, [['site', '.gitignore', true]]);
	assert.match(env.container.textContent ?? '', /\+new/);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});
