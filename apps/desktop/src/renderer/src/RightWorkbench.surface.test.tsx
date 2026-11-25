import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {RightWorkbench} from './RightWorkbench';
import {Command, CommandList} from '@fast-ide/ui/components/command';
import {SurfaceMenuItems} from './surfaces/SurfaceMenuItems';
import {registerAvailableSurface} from './surfaces/surfaceTabs';
import {requestOpenSurface} from './surfaces/openRequest';
import type {AgentReview} from './review/useAgentReview';

type BridgeListener = (payload: {event: unknown; projectId?: string}) => void;

function mockReview(): AgentReview {
	return {
		list: {changes: []},
		pending: [],
		diff: null,
		diffFor: () => undefined,
		fileDiff: async () => null,
		busy: false,
		notice: null,
		expired: new Set(),
		refresh: () => {},
		keep: async () => true,
		planUndo: async () => null,
		applyUndo: async () => true,
		redo: async () => true,
		reviewDiffOn: false
	} as unknown as AgentReview;
}

function setup() {
	const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
		url: 'http://localhost/'
	});
	const g = globalThis as Record<string, unknown>;
	const w = dom.window;
	g.window = w;
	g.document = w.document;
	Object.defineProperty(g, 'navigator', {value: w.navigator, configurable: true, writable: true});
	for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) {
		g[k] = (w as unknown as Record<string, unknown>)[k];
	}
	g.getComputedStyle = w.getComputedStyle.bind(w);
	g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
	g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
	g.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
	g.IntersectionObserver = class {observe() {} unobserve() {} disconnect() {}};
	w.ResizeObserver = g.ResizeObserver;
	w.IntersectionObserver = g.IntersectionObserver;
	w.requestAnimationFrame = g.requestAnimationFrame;
	w.cancelAnimationFrame = g.cancelAnimationFrame;
	w.HTMLElement.prototype.scrollIntoView = () => {};
	w.HTMLElement.prototype.hasPointerCapture = () => false;
	w.HTMLElement.prototype.releasePointerCapture = () => {};
	w.HTMLElement.prototype.setPointerCapture = () => {};
	w.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false, media: ''});
	g.IS_REACT_ACT_ENVIRONMENT = true;

	const listeners = new Set<BridgeListener>();
	const fastIde = {
		listExtensions: async () => ({ok: true as const, extensions: []}),
		onBridgeEvent: (cb: BridgeListener) => {listeners.add(cb); return () => {listeners.delete(cb);};},
		getProject: async () => ({bridgeConnectionId: null}),
		listWorkspaceDir: async () => ({ok: true as const, entries: []}),
		listSessionArchives: async () => [],
		onSessionArchive: () => () => {},
		mintSurfaceToken: async () => ({ok: false as const})
	};
	(w as unknown as Record<string, unknown>).fastIde = fastIde;
	g.fastIde = fastIde;

	const container = w.document.getElementById('root')!;
	const root: Root = createRoot(container);
	const emit = (event: unknown) => {for (const cb of [...listeners]) cb({event, projectId: 'p'});};
	return {dom, root, container, emit, w};
}

const VIBE_OPEN = {
	type: 'surface_open',
	extId: 'vibe3d',
	surfaceId: 'vibe3d.editor',
	url: 'http://127.0.0.1:8000/?t=tok',
	instanceKey: 'k1',
	title: 'Vibe3D'
};

async function renderRail(root: Root) {
	await act(async () => {
		root.render(
			React.createElement(RightWorkbench, {
				changes: [],
				project: null,
				layout: 'coding',
				onCollapse: () => {},
				review: mockReview()
			})
		);
	});
}

const activeTab = (container: Element) => container.querySelector('button[class*="font-medium"]');

test('passive vibe3d surface_open keeps Files active and does not add a tab', async () => {
	const {root, container, emit} = setup();
	await renderRail(root);

	assert.ok(activeTab(container)?.textContent?.includes('Files'), 'Files is active on open');

	await act(async () => {emit(VIBE_OPEN);});

	assert.equal(container.textContent?.includes('Vibe3D'), false, 'passive open must not add a vibe3d tab');
	assert.ok(activeTab(container)?.textContent?.includes('Files'), 'Files stays active after passive vibe3d open');

	await act(async () => {root.unmount();});
});

test('explicit open (artifact card / + menu) creates and activates the vibe3d tab', async () => {
	const {root, container} = setup();
	await renderRail(root);

	await act(async () => {
		requestOpenSurface({
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			url: 'http://127.0.0.1:8000/?t=tok',
			instanceKey: 'k1',
			title: 'Vibe3D'
		});
	});

	assert.ok(activeTab(container)?.textContent?.includes('Vibe3D'), 'explicit open activates vibe3d');
	await act(async () => {root.unmount();});
});

test('+ menu surface section renders the available vibe3d surface', async () => {
	const {root, container} = setup();
	const available = registerAvailableSurface(new Map(), {
		extId: 'vibe3d',
		surfaceId: 'vibe3d.editor',
		url: 'http://127.0.0.1:8000/?t=tok',
		instanceKey: 'k1',
		title: 'Vibe3D'
	});

	await act(async () => {
		root.render(
			React.createElement(
				Command,
				null,
				React.createElement(
					CommandList,
					null,
					React.createElement(SurfaceMenuItems, {available, onSelect: () => {}})
				)
			)
		);
	});

	assert.ok(container.textContent?.includes('Vibe3D'), `surface section should render vibe3d, got [${container.textContent}]`);
	await act(async () => {root.unmount();});
});
