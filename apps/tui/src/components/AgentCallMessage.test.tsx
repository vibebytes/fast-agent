import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {AgentCallMessage} from './AgentCallMessage.js';
import {renderWithProviders, waitForFrame} from '../test-utils/render.js';
import type {AgentCallTimelineItem} from '../state/timeline/model.js';

const base: AgentCallTimelineItem = {
	id: 'agent-run-1',
	kind: 'agent_call',
	agentId: 'a1',
	name: 'agentB_visual',
	depth: 1,
	status: 'failed',
	toolCalls: 1,
	elapsedMs: 6200
};

test('failed agent row shows the failure reason, not just a bare ✗', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{...base, detail: 'Reached maximum turns (200)'}} />
	);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /✗/);
	assert.match(frame, /1 tools · 6\.2s/);
	assert.match(frame, /Reached maximum turns \(200\)/);
	app.unmount();
});

test('failed agent row without a detail still labels the outcome', async () => {
	const app = renderWithProviders(<AgentCallMessage item={base} />);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /失败/);
	app.unmount();
});

test('successful agent row keeps the compact stats-only format', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{...base, status: 'success', tokensUsed: 900}} />
	);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /✓/);
	assert.match(frame, /1 tools · 6\.2s · 900tk/);
	assert.doesNotMatch(frame, /失败/);
	app.unmount();
});

test('running row shows the live tool activity, not just a spinner', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{...base, status: 'running', currentTool: 'shell sbt -batch compile', toolCalls: 3}} />
	);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /→ shell sbt -batch compile/);
	assert.match(frame, /3 tools/);
	app.unmount();
});

test('successful row surfaces the one-line result summary underneath', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{...base, status: 'success', resultSummary: '找到 3 处相关实现'}} />
	);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /└ 找到 3 处相关实现/);
	app.unmount();
});

test('a re-delegation after a failure is marked as a retry', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{...base, status: 'running', isRetry: true}} />
	);
	const frame = await waitForFrame(app, f => f.includes('agentB_visual'), 'agent row');
	assert.match(frame, /agentB_visual \(retry\)/);
	app.unmount();
});

test('trunk row names the parent and aggregates sibling counts', async () => {
	const app = renderWithProviders(
		<AgentCallMessage item={{
			...base,
			id: 'agent-trunk-b1',
			name: 'main',
			status: 'running',
			toolCalls: 7,
			trunk: {total: 3, running: 2, failed: 0}
		}} />
	);
	const frame = await waitForFrame(app, f => f.includes('main'), 'trunk row');
	assert.match(frame, /main — 3 个委派 \(2 running, 1 done\)/);
	app.unmount();
});
