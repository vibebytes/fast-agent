/**
 * Keyboard copy-mode: move a focus point with arrows, Shift to extend,
 * confirm with OSC 52. Wired to Ink Selection via hitTest + Range.
 */
import type {DOMElement, DOMNode} from 'ink';

export type Point = {node: DOMNode; offset: number};

export type CopyModeState = {
	active: boolean;
	cursor: {x: number; y: number};
	anchor?: Point;
	focus?: Point;
};

export type CopyModeEvent =
	| {type: 'enter'; cursor?: {x: number; y: number}; point?: Point}
	| {type: 'exit'}
	| {type: 'clear'}
	| {type: 'move'; x: number; y: number; point?: Point; extend: boolean};

export function initialCopyMode(): CopyModeState {
	return {active: false, cursor: {x: 0, y: 0}};
}

export function reduceCopyMode(state: CopyModeState, event: CopyModeEvent): CopyModeState {
	switch (event.type) {
		case 'enter':
			return {
				active: true,
				cursor: event.cursor ?? {x: 0, y: 0},
				anchor: event.point,
				focus: event.point
			};
		case 'exit':
		case 'clear':
			return {active: false, cursor: {x: 0, y: 0}};
		case 'move': {
			if (!state.active) return state;
			return {
				active: true,
				cursor: {x: event.x, y: event.y},
				anchor: event.extend ? (state.anchor ?? event.point ?? state.focus) : event.point,
				focus: event.point
			};
		}
	}
}

/** OSC 52 clipboard write sequence (base64 payload). */
export function osc52Copy(text: string): string {
	const payload = Buffer.from(text, 'utf8').toString('base64');
	return `\u001b]52;c;${payload}\u0007`;
}

export function writeClipboardOsc52(text: string, stdout: NodeJS.WriteStream = process.stdout): void {
	if (text.length === 0) return;
	stdout.write(osc52Copy(text));
}

export function pointAt(
	root: DOMElement,
	x: number,
	y: number,
	hitTest: (node: DOMElement, x: number, y: number) => Point | undefined
): Point | undefined {
	return hitTest(root, x, y);
}
