/**
 * Synchronous frame capture for component tests that need controlled
 * terminal dimensions. ink-testing-library does not expose columns/rows
 * cleanly; this mirrors @jrichman/ink's render-to-string helper.
 */
import {EventEmitter} from 'node:events';
import React from 'react';
import {render} from 'ink';

type FakeStdout = NodeJS.WriteStream & {
	get: () => string;
	getAll: () => string;
};

function createStdout(columns: number, rows: number): FakeStdout {
	const stdout = new EventEmitter() as unknown as FakeStdout;
	stdout.columns = columns;
	stdout.rows = rows;
	const chunks: string[] = [];
	stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
		return true;
	}) as NodeJS.WriteStream['write'];
	stdout.get = () => chunks.at(-1) ?? '';
	stdout.getAll = () => chunks.join('');
	return stdout;
}

export type FrameOptions = {
	columns?: number;
	rows?: number;
	/** When true, each render appends instead of replacing (Ink debug mode). */
	debug?: boolean;
	terminalBuffer?: boolean;
	incrementalRendering?: boolean;
};

export type CapturedFrame = {
	/** Last frame written to stdout (ANSI escapes included). */
	raw: string;
	/** All writes concatenated. */
	all: string;
	/** ANSI-stripped last frame. */
	plain: string;
	unmount: () => void;
};

export function stripAnsi(text: string): string {
	return text
		.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
		.replace(/[ \t]+$/gm, '');
}

/**
 * Render a React tree once and capture the output frame.
 * Uses Ink's debug mode by default so the full frame is emitted as a string.
 */
export function renderToFrame(
	node: React.ReactElement,
	options: FrameOptions = {}
): CapturedFrame {
	const columns = options.columns ?? 80;
	const rows = options.rows ?? 24;
	const stdout = createStdout(columns, rows);
	const previousColumns = process.stdout.columns;
	const previousRows = process.stdout.rows;
	Object.defineProperty(process.stdout, 'columns', {value: columns, configurable: true});
	Object.defineProperty(process.stdout, 'rows', {value: rows, configurable: true});

	const instance = render(node, {
		stdout,
		debug: options.debug ?? true,
		exitOnCtrlC: false,
		patchConsole: false,
		...(options.terminalBuffer !== undefined ? {terminalBuffer: options.terminalBuffer} : {}),
		...(options.incrementalRendering !== undefined
			? {incrementalRendering: options.incrementalRendering}
			: {})
	});

	const raw = stdout.get();
	const all = stdout.getAll();
	instance.unmount();

	Object.defineProperty(process.stdout, 'columns', {value: previousColumns, configurable: true});
	Object.defineProperty(process.stdout, 'rows', {value: previousRows, configurable: true});

	return {
		raw,
		all,
		plain: stripAnsi(raw).trimEnd(),
		unmount: () => undefined
	};
}
