import assert from 'node:assert/strict';
import test from 'node:test';
import {fieldValue, isConflict, schemaFields} from './settings';

test('schemaFields reads DSH schemastery unions used on the general page', () => {
	const permission = schemaFields({
		uid: 575,
		refs: {
			570: {type: 'const', meta: {}, value: 'read-only'},
			571: {type: 'const', meta: {}, value: 'workspace-write'},
			572: {type: 'const', meta: {}, value: 'danger-full-access'},
			574: {type: 'union', meta: {required: true}, list: [570, 571, 572]},
			575: {type: 'object', meta: {default: {}}, dict: {defaultPreset: 574}}
		}
	});
	assert.deepEqual(
		permission.map(f => f.key),
		['defaultPreset']
	);
	assert.deepEqual(permission[0]?.enum, ['read-only', 'workspace-write', 'danger-full-access']);

	const locale = schemaFields({
		uid: 185,
		refs: {
			181: {type: 'const', meta: {required: true}, value: 'zh'},
			183: {type: 'const', meta: {required: true}, value: 'en'},
			184: {type: 'union', meta: {required: false}, list: [181, 183]},
			185: {type: 'object', meta: {default: {}}, dict: {preference: 184}}
		}
	});
	assert.deepEqual(locale[0]?.enum, ['zh', 'en']);

	const enter = schemaFields({
		uid: 194,
		refs: {
			190: {type: 'const', meta: {required: true}, value: 'queue'},
			192: {type: 'const', meta: {required: true}, value: 'steer'},
			193: {type: 'union', meta: {default: 'queue'}, list: [190, 192]},
			194: {type: 'object', meta: {default: {}}, dict: {busyEnter: 193}}
		}
	});
	assert.equal(enter[0]?.key, 'busyEnter');
	assert.equal(enter[0]?.fallback, 'queue');
});

test('schemaFields skips secret slots and still reads plugin numbers', () => {
	const fields = schemaFields({
		uid: 242,
		refs: {
			225: {type: 'string', meta: {role: 'secret'}},
			228: {type: 'string', meta: {role: 'credential-ref', default: 'DEEPSEEK_API_KEY'}},
			241: {type: 'number', meta: {step: 1, min: 1, default: 5}},
			242: {type: 'object', meta: {default: {}}, dict: {apiKey: 225, apiKeyEnv: 228, maxUses: 241}}
		}
	});
	assert.deepEqual(
		fields.map(f => [f.key, f.type]),
		[
			['apiKeyEnv', 'string'],
			['maxUses', 'number']
		]
	);
});

test('isConflict recognizes DSH settings-conflict and the revision message', () => {
	assert.equal(isConflict({code: 'settings-conflict', message: 'stale'}), true);
	assert.equal(
		isConflict({
			code: 'internal',
			message: 'settings namespace "agent-presets" changed since it was read (expected revision 7, now 8)'
		}),
		true
	);
	assert.equal(isConflict({code: 'unavailable'}), false);
});

test('fieldValue prefers the live value then base then schema default', () => {
	assert.equal(fieldValue({preference: 'en'}, 'preference', 'zh'), 'en');
	assert.equal(fieldValue({}, 'preference', 'zh'), 'zh');
	assert.equal(fieldValue(undefined, 'preference', 'zh'), 'zh');
});
