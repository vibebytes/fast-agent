import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchCatalogEntry, sameModelRef} from './modelMatch.js';

const glm52 = {
	id: 'zhipu/glm-5.2',
	display: 'GLM-5.2',
	aliases: ['glm-5.2']
};
const glm53 = {
	id: 'zhipu/glm-5.3',
	display: 'GLM-5.3',
	aliases: ['glm-5.3']
};

test('sameModelRef: platform/id equals bare display of the same model only', () => {
	assert.equal(sameModelRef('zhipu/glm-5.3', 'zhipu/glm-5.3'), true);
	assert.equal(sameModelRef('zhipu/glm-5.3', 'GLM-5.3'), true);
	assert.equal(sameModelRef('zhipu/glm-5.3', 'glm-5.3'), true);
	assert.equal(sameModelRef('zhipu/glm-5.3', 'zhipu/glm-5.2'), false);
	assert.equal(sameModelRef('zhipu/glm-5.3', 'GLM-5.2'), false);
	assert.equal(sameModelRef('zhipu/glm-5.2', 'zhipu/glm-5.3'), false);
});

test('matchCatalogEntry: find() must not return an earlier sibling for a manual add', () => {
	const catalog = [glm52, glm53];
	assert.equal(
		catalog.find(e => matchCatalogEntry(e, 'zhipu/glm-5.3')),
		glm53
	);
	assert.equal(
		catalog.find(e => matchCatalogEntry(e, 'GLM-5.3')),
		glm53
	);
	assert.equal(
		catalog.find(e => matchCatalogEntry(e, 'zhipu/glm-5.2')),
		glm52
	);
	assert.equal(
		catalog.find(e => matchCatalogEntry(e, 'zhipu/manual-r1')) === undefined,
		true
	);
});
