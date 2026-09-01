import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
	MARKDOWN_SHIKI_TRANSPARENT_SELECTORS,
	TOOL_COMMAND_SECTION_BORDER,
	WINDOW_FRAME_SOFT_CHROME
} from './sessionVisualPlane.js';

const here = dirname(fileURLToPath(import.meta.url));

test('WindowFrame soft chrome matches grilled opacities as static classes', () => {
	assert.equal(WINDOW_FRAME_SOFT_CHROME.headerBg, 'bg-muted/15');
	assert.equal(WINDOW_FRAME_SOFT_CHROME.headerHover, 'hover:bg-muted/30');
	assert.equal(WINDOW_FRAME_SOFT_CHROME.border, 'border-border/50');
	assert.equal(TOOL_COMMAND_SECTION_BORDER, 'border-border/50');

	const frame = readFileSync(join(here, '../components/window-frame.tsx'), 'utf8');
	assert.match(frame, /bg-muted\/15/);
	assert.match(frame, /hover:bg-muted\/30/);
	assert.match(frame, /border-border\/50/);
	assert.doesNotMatch(frame, /WINDOW_FRAME_SOFT_CHROME/);
	assert.doesNotMatch(frame, /bg-muted\/40/);
	assert.doesNotMatch(frame, /hover:bg-muted\/70/);

	const toolCard = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/ToolCard.tsx'),
		'utf8'
	);
	assert.match(toolCard, /border-border\/50/);
	assert.doesNotMatch(toolCard, /TOOL_COMMAND_SECTION_BORDER/);
});

test('globals.css forces transparent backgrounds on markdown-shiki plates', () => {
	const css = readFileSync(join(here, '../styles/globals.css'), 'utf8');
	for (const sel of MARKDOWN_SHIKI_TRANSPARENT_SELECTORS) {
		assert.ok(css.includes(sel), `missing selector ${sel}`);
	}
	assert.match(css, /background-color:\s*transparent\s*!important/);
});

test('streaming activity uses CSS animations independent of Transcript frames', () => {
	const css = readFileSync(join(here, '../styles/globals.css'), 'utf8');
	const markdown = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/MarkdownMessage.tsx'),
		'utf8'
	);
	const timeline = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/session/TimelineRow.tsx'),
		'utf8'
	);
	assert.match(markdown, /streaming-markdown/);
	// Live tip uses shadcn.io AI Shimmer (motion backgroundPosition sweep).
	assert.doesNotMatch(timeline, /thinking-active|Thinking…/);
	assert.match(timeline, /TextShimmer/);
	assert.match(timeline, /processStackCollapsedLabel/);
	const shimmer = readFileSync(
		join(here, '../components/ai-shimmer.tsx'),
		'utf8'
	);
	assert.match(shimmer, /from 'motion\/react'/);
	assert.match(shimmer, /backgroundPosition/);
	assert.match(
		css,
		/@keyframes ai-shimmer-header\s*\{[\s\S]{0,240}transform:\s*translate3d/
	);
	assert.doesNotMatch(
		css,
		/@keyframes ai-shimmer-header\s*\{[\s\S]{0,240}background-position/
	);
});

test('Transcript uses a quiet execution rail and human-readable skill context', () => {
	const timeline = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/session/TimelineRow.tsx'),
		'utf8'
	);
	const markdown = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/MarkdownMessage.tsx'),
		'utf8'
	);
	const tool = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/ToolCard.tsx'),
		'utf8'
	);

	assert.match(timeline, /data-slot="process-rail"/);
	assert.match(timeline, /before:bg-muted-foreground\/45/);
	assert.doesNotMatch(timeline, />▸</);
	assert.match(markdown, /text-\[13\.5px\] leading-\[1\.65\]/);
	assert.match(tool, /Skill/);
	assert.match(tool, /parseSkillEnvelope/);
});

test('Tool cards re-normalize cached output and collapse successful commands', () => {
	const tool = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/ToolCard.tsx'),
		'utf8'
	);
	assert.match(tool, /const output = displayToolOutput\(item\.output\)/);
	assert.match(tool, /thresholdFold \|\| item\.status === 'success'/);
	assert.match(tool, /collapsible=\{collapsible\}/);
	assert.match(tool, /<ToolOutput output=\{output\}/);
});

test('FileEditCard diff row tints stay outside markdown-shiki plate rules', () => {
	const file = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/session/FileEditCard.tsx'),
		'utf8'
	);
	assert.match(file, /bg-emerald-500\/10/);
	assert.match(file, /bg-red-500\/10/);
	assert.doesNotMatch(file, /markdown-shiki/);
});

test('default light --sidebar sits one plane step below --background', () => {
	const css = readFileSync(join(here, '../styles/globals.css'), 'utf8');
	const root = css.match(/:root\s*\{([^}]+)\}/);
	assert.ok(root);
	const block = root![1]!;
	assert.match(block, /--background:\s*oklch\(1\s+0\s+0\)/);
	assert.match(block, /--sidebar:\s*oklch\(0\.98\s+0\s+0\)/);
});

test('sidebar menu uses compact h-7 Clear hover/selected', () => {
	const src = readFileSync(join(here, '../components/sidebar.tsx'), 'utf8');
	assert.match(src, /hover:bg-sidebar-accent/);
	assert.match(src, /data-\[active=true\]:bg-sidebar-accent/);
	assert.match(src, /sm:\s*"h-7 text-xs"/);
	assert.doesNotMatch(src, /SIDEBAR_ROW_CHROME/);
	assert.doesNotMatch(src, /mx-3\.5[\s\S]{0,80}border-l border-sidebar-border/);
});

test('TimelineRow user prompt is full-width soft pill on tokens', () => {
	const src = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/session/TimelineRow.tsx'),
		'utf8'
	);
	assert.match(src, /'w-full border-0 bg-muted\/70'/);
	assert.match(
		src,
		/dockedBelow \? 'rounded-t-2xl rounded-b-none' : 'rounded-2xl'/
	);
	assert.match(src, /bg-muted\/70/);
	assert.match(src, /border-0/);
	assert.doesNotMatch(src, /max-w-\[min\(100%,36rem\)\]/);
	assert.doesNotMatch(src, /USER_PROMPT_PILL/);
	assert.doesNotMatch(src, /border-border\/60 bg-muted\/50/);
	assert.match(src, /w-\[calc\(100%-2\.5rem\)\]/);
});

test('SessionPane drawer and DialogueComposer share one visual surface', () => {
	const pane = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/session/SessionPane.tsx'),
		'utf8'
	);
	const composer = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/DialogueComposer.tsx'),
		'utf8'
	);
	assert.match(
		pane,
		/data-slot="composer-surface"[\s\S]{0,500}\{hasComposerStack \? composerStack : null\}[\s\S]{0,120}<DialogueComposer/
	);
	assert.doesNotMatch(
		composer,
		/overflow-hidden rounded-3xl border border-border\/70 bg-background shadow-sm/
	);
});

test('ProjectsSidebar: Project hover-only; Task selected; compact full-width rows', () => {
	const src = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/ProjectsSidebar.tsx'),
		'utf8'
	);
	assert.match(src, /!project\.active && 'hover:bg-sidebar-accent'/);
	assert.doesNotMatch(
		src,
		/group\/project-row[\s\S]{0,200}project\.active &&\s*\n\s*'bg-sidebar-accent/
	);
	assert.match(src, /taskActive &&/);
	assert.match(src, /relative flex h-7 w-full min-w-0 items-center rounded-sm/);
	assert.match(src, /pl-7/);
	assert.doesNotMatch(src, /border-l border-sidebar-border/);
	assert.doesNotMatch(src, /\bml-3\b/);
});

test('ProjectsSidebar: default Tasks delegate archive/delete with Default Project scope', () => {
	const src = readFileSync(
		join(here, '../../../../../apps/desktop/src/renderer/src/ProjectsSidebar.tsx'),
		'utf8'
	);
	assert.match(src, /defaultProject=\{model\.defaultProjectSnapshot\}/);
	assert.match(
		src,
		/onArchive=\{\(\) => actions\.requestArchiveTask\(defaultProject, task\)\}/
	);
	assert.match(
		src,
		/onDelete=\{\(\) => actions\.requestDeleteTask\(defaultProject, task\)\}/
	);
});
