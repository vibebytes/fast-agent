import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {projectLabel} from './projectLabel';

describe('projectLabel', () => {
	it('prefers human display name', () => {
		assert.equal(projectLabel('019f9cf2-7448-7ebf-bf69-a2f7967143dc', 'quant'), 'quant');
	});

	it('shortens UUID when no display name', () => {
		assert.equal(
			projectLabel('019f9cf2-7448-7ebf-bf69-a2f7967143dc'),
			'Project 019f9cf2'
		);
	});

	it('keeps non-id names', () => {
		assert.equal(projectLabel('default-project', null), 'default-project');
	});
});
