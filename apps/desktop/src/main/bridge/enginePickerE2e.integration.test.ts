/**
 * L1 E2E: the composer engine picker is gated by the engine's own ListEngines
 * rows, not by engines.yaml `enabled` and not by a hardcoded id list.
 *
 * The chain under test is the production one:
 *   engine ListEngines -> pickerEngineIds(rows) -> SessionController.setAvailableEngines
 *   -> SessionController.setEngineKind(id)
 *
 * Two phases, same placed engine, only the dsh install state differs:
 *   A. dsh NOT installed (no .installed marker, no dshd): the row must report
 *      program=missing / adapter=disabled, so `dsh` must NOT be switchable.
 *      This is the regression guard: flipping engines.yaml `enabled` alone must
 *      never make dsh selectable.
 *   B. dsh installed + dshd running (startDshScenario): the row must become
 *      switchable and `dsh` must be accepted by setEngineKind.
 *
 * FAST_E2E_ENGINE selects the engine (see e2e/engineSource.ts): 'placed'
 * (default, skipped when absent), 'stage' (sbt stage of the agent repo) or a
 * dist directory path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {EngineWireRow} from '@fast-ide/session-view';
import {startStubLlm} from './e2e/stubLlmServer.js';
import {engineCommandFor, makeEngineFixture, type EngineFixture, type EngineLaunch} from './e2e/engineE2eFixture.js';
import {EngineSessionHarness} from './e2e/sessionHarness.js';
import {startDshScenario} from './e2e/dshScenario.js';
import {pickerEngineIds, switchableEngine} from './workspace/enginePickerIds.js';

const listEngines = async (h: EngineSessionHarness): Promise<EngineWireRow[]> => {
	h.bridge.send({type: 'ListEngines'} as never);
	const ev = await h.waitEvent('command_result', (e: any) => e.name === 'ListEngines', {what: 'ListEngines'});
	assert.notEqual((ev as any).status, 'error', `ListEngines failed: ${(ev as any).message}`);
	return ((ev as any).engines ?? []) as EngineWireRow[];
};

const rowOf = (rows: EngineWireRow[], id: string): EngineWireRow => {
	const row = rows.find(r => r.id.trim().toLowerCase() === id);
	assert.ok(row, `no ${id} row in ListEngines: ${JSON.stringify(rows)}`);
	return row;
};

const openSession = async (fixture: EngineFixture, h: EngineSessionHarness): Promise<void> => {
	h.bridge.send({type: 'RegisterWorkspace', path: fixture.project});
	await h.waitEvent('command_result', (e: any) => e.name === 'RegisterWorkspace', {what: 'RegisterWorkspace'});
	h.bridge.send({type: 'command', name: 'new', args: 'picker probe'});
	const created = await h.waitEvent('command_result', (e: any) => e.name === 'new' && (e as any).sessionId, {
		what: 'new(picker probe)'
	});
	h.controller.acceptNewSession(String((created as any).sessionId), h.controller.getActiveTask()?.id ?? '', 'ws-1');
};

const runPhaseA = async (fixture: EngineFixture, launch: EngineLaunch): Promise<void> => {
	const h = EngineSessionHarness.start(fixture.project, fixture.env, launch, 'picker-e2e-a');
	try {
		await h.waitEvent('ready', undefined, {what: 'ready'});
		const rows = await listEngines(h);
		const dsh = rowOf(rows, 'dsh');

		assert.equal(
			switchableEngine(dsh),
			false,
			`dsh must not be switchable while uninstalled — row: ${JSON.stringify(dsh)}`
		);
		assert.ok(
			!pickerEngineIds(rows).includes('dsh'),
			`picker must not offer dsh while uninstalled: ${JSON.stringify(pickerEngineIds(rows))}`
		);

		await openSession(fixture, h);
		h.controller.setAvailableEngines(pickerEngineIds(rows));
		assert.equal(
			h.controller.setEngineKind('dsh'),
			false,
			'setEngineKind(dsh) must be refused when the engine reports dsh as uninstalled'
		);
		assert.equal(h.controller.engineKind, 'fast', 'engine kind must stay fast after the refusal');
	} finally {
		await h.close();
	}
};

const runPhaseB = async (fixture: EngineFixture, launch: EngineLaunch, stubLlmBaseUrl: string, t: TestContext): Promise<void> => {
	const dsh = await startDshScenario(fixture, launch.command[0], stubLlmBaseUrl);
	t.after(() => dsh.cleanup());

	const h = EngineSessionHarness.start(fixture.project, {...fixture.env, ...dsh.dshEnv}, launch, 'picker-e2e-b');
	try {
		await h.waitEvent('ready', undefined, {what: 'ready'});
		const rows = await listEngines(h);
		const dshRow = rowOf(rows, 'dsh');

		assert.equal(
			switchableEngine(dshRow),
			true,
			`dsh must be switchable once installed and running — row: ${JSON.stringify(dshRow)}`
		);
		assert.ok(
			pickerEngineIds(rows).includes('dsh'),
			`picker must offer dsh once installed: ${JSON.stringify(pickerEngineIds(rows))}`
		);

		await openSession(fixture, h);
		h.controller.setAvailableEngines(pickerEngineIds(rows));
		assert.equal(h.controller.setEngineKind('dsh'), true, 'setEngineKind(dsh) must be accepted once dsh is available');
		assert.equal(h.controller.engineKind, 'dsh', 'engine kind must switch to dsh');
	} finally {
		await h.close();
	}
};

test('engine picker offers dsh only when the engine reports it installed', async t => {
	const stub = await startStubLlm([{text: 'ok'}]);
	try {
		const launch = engineCommandFor({});
		if (!launch) {
			t.skip('no placed engine binary: run fast/scripts/fetch-engine.sh or set FAST_ENGINE_COMMAND');
			return;
		}
		const fixture = await makeEngineFixture(stub.baseUrl);
		try {
			await runPhaseA(fixture, launch);
			await runPhaseB(fixture, launch, stub.baseUrl, t);
		} finally {
			await fixture.cleanup();
		}
	} finally {
		await stub.close();
	}
});
