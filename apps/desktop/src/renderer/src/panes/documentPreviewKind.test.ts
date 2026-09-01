import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {documentPreviewKind} from './documentPreviewKind';

describe('documentPreviewKind', () => {
	it('maps markdown extensions', () => {
		assert.equal(documentPreviewKind('README.md'), 'markdown');
		assert.equal(documentPreviewKind('notes.markdown'), 'markdown');
		assert.equal(documentPreviewKind('doc.mdx'), 'markdown');
		assert.equal(documentPreviewKind('nested/a.mdown'), 'markdown');
	});

	it('maps html and svg', () => {
		assert.equal(documentPreviewKind('index.html'), 'html');
		assert.equal(documentPreviewKind('page.HTM'), 'html');
		assert.equal(documentPreviewKind('logo.svg'), 'svg');
	});

	it('uses the basename so a dotted directory does not win', () => {
		assert.equal(documentPreviewKind('foo.md/bar.ts'), null);
		assert.equal(documentPreviewKind('foo.md/bar.html'), 'html');
	});

	it('is source-only for everything else, including html-like templates', () => {
		assert.equal(documentPreviewKind('app.tsx'), null);
		assert.equal(documentPreviewKind('App.vue'), null);
		assert.equal(documentPreviewKind('Widget.svelte'), null);
		assert.equal(documentPreviewKind('Untitled'), null);
		assert.equal(documentPreviewKind(null), null);
		assert.equal(documentPreviewKind(''), null);
	});
});
