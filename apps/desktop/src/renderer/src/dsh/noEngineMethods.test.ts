import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const methods = [
	'session.models',
	'session.selectModel',
	'skill.list',
	'settings.describe',
	'settings.update',
	'settings.mutate',
	'settings.replace',
	'settings.openDocument',
	'credentials.describe',
	'credentials.set',
	'credentials.unset',
	'llm.models',
	'llm.providers',
	'llm.discoverModels',
	'agentPreset.list',
	'agentPreset.select',
	'agentPreset.read',
	'agentPreset.copy',
	'agentPreset.openDocument',
	'agentPreset.remove',
	'session.list',
	'pluginInventory.list',
	'session.updateQueue',
	'session.attachment',
	'goal.create',
	'goal.edit',
	'goal.pause',
	'goal.resume',
	'goal.complete',
	'goal.clear',
	'subagent.history',
	'subagent.prompt',
	'subagent.interrupt'
];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walk(path);
		if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts')) return [];
		return [path];
	});
}

test('first-party DSH UI does not write engine method strings or dshCall', () => {
	const root = fileURLToPath(new URL('.', import.meta.url));
	for (const file of walk(root)) {
		const text = readFileSync(file, 'utf8');
		assert.equal(text.includes('dshCall('), false, file);
		for (const method of methods) {
			assert.equal(text.includes(`'${method}'`), false, `${file} ${method}`);
			assert.equal(text.includes(`"${method}"`), false, `${file} ${method}`);
		}
	}
});
