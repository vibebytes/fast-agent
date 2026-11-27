import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import type {GitFileDiffResult, GitStatus} from '@fast-ide/session-view';

type Panes = {
	ChangesPane: typeof import('./ChangesPane').ChangesPane;
	GitDiffPane: typeof import('./GitDiffPane').GitDiffPane;
};

let panes: Panes | null = null;

/** Radix portals only mount when React DOM loads after the jsdom globals exist. */
async function loadPanes(): Promise<Panes> {
	if (!panes) {
		const [{ChangesPane}, {GitDiffPane}] = await Promise.all([
			import('./ChangesPane'),
			import('./GitDiffPane')
		]);
		panes = {ChangesPane, GitDiffPane};
	}
	return panes;
}

async function setup(diff: GitFileDiffResult) {
	const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url: 'http://localhost/'});
	const g = globalThis as Record<string, unknown>;
	g.window = dom.window;
	g.document = dom.window.document;
	Object.defineProperty(g, 'navigator', {value: dom.window.navigator, configurable: true});
	const w = dom.window as unknown as Record<string, unknown>;
	for (const key of [
		'HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent',
		'HTMLInputElement', 'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement',
		'HTMLIFrameElement', 'HTMLHtmlElement', 'HTMLBodyElement', 'HTMLDivElement', 'HTMLSpanElement',
		'Range', 'NodeFilter', 'ShadowRoot', 'Document', 'DocumentFragment', 'DOMRect', 'DOMRectReadOnly'
	]) {
		const value = w[key];
		if (value === undefined) continue;
		g[key] = value;
		w[key] = value;
	}
	g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
	g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
	g.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
	w.ResizeObserver = g.ResizeObserver;
	w.requestAnimationFrame = g.requestAnimationFrame;
	w.cancelAnimationFrame = g.cancelAnimationFrame;
	g.MutationObserver = dom.window.MutationObserver;
	w.MutationObserver = g.MutationObserver;
	dom.window.HTMLElement.prototype.scrollIntoView = () => {};
	dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
	dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
	dom.window.HTMLElement.prototype.setPointerCapture = () => {};
	g.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: Array<[string, string, boolean | undefined]> = [];
	const revealed: string[] = [];
	(dom.window as unknown as Record<string, unknown>).fastIde = {
		gitFileDiff: async (repoPath: string, relativePath: string, includeHunks?: boolean) => {
			calls.push([repoPath, relativePath, includeHunks]);
			return diff;
		},
		showWorkspacePathInFolder: async (relativePath: string) => {
			revealed.push(relativePath);
			return true;
		}
	};
	const {createRoot} = await import('react-dom/client');
	const container = dom.window.document.getElementById('root')!;
	const root = createRoot(container);
	return {dom, root, container, calls, revealed};
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
	const env = await setup({ok: true, file: null});
	const {ChangesPane} = await loadPanes();
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
	const env = await setup({ok: true, file: null});
	const {ChangesPane} = await loadPanes();
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
	const env = await setup({ok: true, file: null});
	const {ChangesPane} = await loadPanes();
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

test('repository headers show the workspace-relative path, except at the root', async () => {
	const env = await setup({ok: true, file: null});
	const {ChangesPane} = await loadPanes();
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenDiff={() => {}} />);
	});
	const nestedPath = env.container.querySelector('[data-testid="git-repo-path-nested"]');
	assert.ok(nestedPath, 'nested repository should render its relative path');
	assert.equal(nestedPath.textContent, 'nested');
	assert.equal(env.container.querySelector('[data-testid="git-repo-path-"]'), null);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('repository context menu reveals the repository folder', async () => {
	const env = await setup({ok: true, file: null});
	const {ChangesPane} = await loadPanes();
	await act(async () => {
		env.root.render(<ChangesPane status={status} onOpenDiff={() => {}} />);
	});
	const header = env.container.querySelector('[data-testid="git-repo-nested"]')!;
	await act(async () => {
		header.dispatchEvent(new env.dom.window.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 10, clientY: 10}));
		await new Promise(resolve => setTimeout(resolve, 30));
	});
	const item = env.dom.window.document.querySelector('[data-testid="git-repo-reveal-nested"]');
	assert.ok(item, 'context menu should offer reveal-in-folder');
	await act(async () => {
		item!.dispatchEvent(new env.dom.window.MouseEvent('click', {bubbles: true}));
		await Promise.resolve();
	});
	assert.deepEqual(env.revealed, ['nested']);
	await act(async () => env.root.unmount());
	env.dom.window.close();
});

test('Git diff tab requests hunks and renders binary and truncated states', async () => {
	const tab = {id: 'git', kind: 'diff' as const, title: 'a.txt', repoPath: 'nested', filePath: 'a.txt'};
	const binaryEnv = await setup({
		ok: true,
		file: {path: 'a.txt', additions: 0, deletions: 0, hunks: [], binary: true}
	});
	const {GitDiffPane} = await loadPanes();
	await act(async () => {
		binaryEnv.root.render(<GitDiffPane tab={tab} />);
		await Promise.resolve();
	});
	assert.deepEqual(binaryEnv.calls, [['nested', 'a.txt', true]]);
	assert.match(binaryEnv.container.textContent ?? '', /shell\.changes\.scmBinary/);
	await act(async () => binaryEnv.root.unmount());
	binaryEnv.dom.window.close();

	const truncatedEnv = await setup({
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
	const env = await setup({
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
	const {GitDiffPane} = await loadPanes();
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
