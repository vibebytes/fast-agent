import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ChangesPane} from './ChangesPane';
import type {GitFileDiffResult, GitStatus} from '@fast-ide/session-view';

function setup(diff: GitFileDiffResult) {
	const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
		url: 'http://localhost/'
	});
	const g = globalThis as Record<string, unknown>;
	g.window = dom.window;
	g.document = dom.window.document;
	Object.defineProperty(g, 'navigator', {value: dom.window.navigator, configurable: true});
	for (const key of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'MouseEvent']) {
		g[key] = (dom.window as unknown as Record<string, unknown>)[key];
	}
	g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	g.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: Array<[string, string]> = [];
	(dom.window as unknown as Record<string, unknown>).fastIde = {
		gitFileDiff: async (repoPath: string, relativePath: string) => {
			calls.push([repoPath, relativePath]);
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

test('renders repository groups without review data and loads a diff on click', async () => {
	const env = setup({
		ok: true,
		file: {
			path: 'a.txt',
			additions: 1,
			deletions: 1,
			hunks: [{header: '@@ -1 +1 @@', lines: ['-old', '+new']}]
		}
	});
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenFile={() => {}} />);
	});
	assert.match(env.container.textContent ?? '', /root-repo/);
	assert.match(env.container.textContent ?? '', /nested-repo/);
	const toggle = env.container.querySelector('[data-testid="git-change-:a.txt"]');
	assert.ok(toggle, 'file row should be clickable');
	await act(async () => {
		toggle.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
		await Promise.resolve();
	});
	assert.deepEqual(env.calls, [['', 'a.txt']]);
	assert.match(env.container.textContent ?? '', /\+new/);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('opens a nested repository file with its workspace-relative path', async () => {
	const env = setup({ok: true, file: null});
	const opened: string[] = [];
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenFile={path => opened.push(path)} />);
	});
	const open = env.container.querySelector('[data-testid="git-open-nested:b.txt"]');
	assert.ok(open, 'nested file name should be clickable');
	await act(async () => {
		open.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
	});
	assert.deepEqual(opened, ['nested/b.txt']);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('renders binary and truncated diff states', async () => {
	const binaryEnv = setup({
		ok: true,
		file: {path: 'a.txt', additions: 0, deletions: 0, hunks: [], binary: true}
	});
	await act(async () => {
		binaryEnv.root.render(<ChangesPane status={status} onOpenFile={() => {}} />);
	});
	const binaryToggle = binaryEnv.container.querySelector('[data-testid="git-change-:a.txt"]')!;
	await act(async () => {
		binaryToggle.dispatchEvent(new binaryEnv.dom.window.MouseEvent('click', {bubbles: true}));
		await Promise.resolve();
	});
	assert.match(binaryEnv.container.textContent ?? '', /shell\.changes\.scmBinary/);
	await act(async () => binaryEnv.root.unmount());
	binaryEnv.dom.window.close();

	const truncatedEnv = setup({
		ok: true,
		file: {
			path: 'a.txt',
			additions: 1,
			deletions: 0,
			hunks: [{header: '@@ -0,0 +1 @@', lines: ['+partial']}],
			truncated: true
		}
	});
	await act(async () => {
		truncatedEnv.root.render(<ChangesPane status={status} onOpenFile={() => {}} />);
	});
	const truncatedToggle = truncatedEnv.container.querySelector('[data-testid="git-change-:a.txt"]')!;
	await act(async () => {
		truncatedToggle.dispatchEvent(new truncatedEnv.dom.window.MouseEvent('click', {bubbles: true}));
		await Promise.resolve();
	});
	assert.match(truncatedEnv.container.textContent ?? '', /shell\.changes\.scmTruncated/);
	await act(async () => truncatedEnv.root.unmount());
	truncatedEnv.dom.window.close();
});
