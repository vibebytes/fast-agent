/**
 * Inline @mention composer — real chips mixed with text (contenteditable).
 * Same chip chrome as / skill; caret stays native to the editable.
 */
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	type ClipboardEvent,
	type KeyboardEvent
} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';
import type {MentionChip} from './env';
import {atQuerySpan, chipFromAtItem, mergeChip, type AtItem} from './atCatalog';
import {planPaste} from './pastePlan';

const CHIP_ATTR = 'data-mention-chip';

const SYSTEM_BLUE_CHIP =
	'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

export type MentionRichSnapshot = {
	text: string;
	chips: MentionChip[];
	/** Plain text before caret (chips contribute their ref) — for @ suggest. */
	beforeCaret: string;
};

export type MentionRichInputHandle = {
	focus: () => void;
	clear: () => void;
	snapshot: () => MentionRichSnapshot;
	/** Drop active `@partial` and insert an inline chip at the caret. */
	insertChip: (item: AtItem) => MentionRichSnapshot;
	restore: (text: string, chips: MentionChip[]) => void;
};

type Props = {
	disabled?: boolean;
	placeholder?: string;
	className?: string;
	onChange?: (snap: MentionRichSnapshot) => void;
	onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
	/** Real clipboard files (Finder copy); pathless blobs (screenshots) are dropped by the host. */
	onPasteFiles?: (files: File[]) => void;
};

function chipKey(c: MentionChip): string {
	return c.ref ?? `@${c.kind}/${c.locator}`;
}

function readChip(el: HTMLElement): MentionChip {
	return {
		kind: el.dataset.kind ?? 'file',
		locator: el.dataset.locator ?? '',
		displayName: el.dataset.display,
		ref: el.dataset.ref,
		...(el.dataset.entity ? {entity: el.dataset.entity} : {})
	};
}

function createChipEl(chip: MentionChip): HTMLSpanElement {
	const key = chipKey(chip);
	const el = document.createElement('span');
	el.setAttribute(CHIP_ATTR, '');
	el.contentEditable = 'false';
	el.dataset.kind = chip.kind;
	el.dataset.locator = chip.locator;
	el.dataset.ref = chip.ref ?? key;
	if (chip.displayName) el.dataset.display = chip.displayName;
	if (chip.entity) el.dataset.entity = chip.entity;
	el.className = cn(
		'mx-0.5 inline-flex max-w-[min(100%,16rem)] translate-y-px items-center gap-1',
		'rounded-md px-1.5 py-0.5 text-[13px] font-medium align-baseline',
		SYSTEM_BLUE_CHIP
	);

	const icon = document.createElement('span');
	icon.className = 'select-none text-[11px] leading-none opacity-80';
	icon.setAttribute('aria-hidden', 'true');
	icon.textContent = chip.kind === 'skill' ? '▣' : '◉';

	const label = document.createElement('span');
	label.className = 'truncate';
	label.textContent = chip.displayName ?? chip.ref ?? key;

	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className =
		'rounded-sm px-0.5 text-[12px] leading-none opacity-60 hover:opacity-100';
	remove.setAttribute('aria-label', 'Remove mention');
	remove.textContent = '×';
	remove.addEventListener('mousedown', e => {
		e.preventDefault();
		e.stopPropagation();
	});
	remove.addEventListener('click', e => {
		e.preventDefault();
		e.stopPropagation();
		const parent = el.parentNode;
		el.remove();
		if (parent instanceof HTMLElement) {
			parent.dispatchEvent(new Event('mention-chip-removed', {bubbles: true}));
		}
	});

	el.append(icon, label, remove);
	return el;
}

function serialize(root: HTMLElement): {text: string; chips: MentionChip[]} {
	const chips: MentionChip[] = [];
	let text = '';
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? '';
			return;
		}
		if (!(node instanceof HTMLElement)) return;
		if (node.hasAttribute(CHIP_ATTR)) {
			const c = readChip(node);
			chips.push(c);
			text += c.ref ?? chipKey(c);
			return;
		}
		node.childNodes.forEach(walk);
	};
	root.childNodes.forEach(walk);
	return {text, chips};
}

function plainBeforeCaret(root: HTMLElement): string {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
		return serialize(root).text;
	}
	const endRange = sel.getRangeAt(0);
	const probe = document.createRange();
	probe.selectNodeContents(root);
	probe.setEnd(endRange.startContainer, endRange.startOffset);
	const holder = document.createElement('div');
	holder.append(probe.cloneContents());
	return serialize(holder).text;
}

function placeCaretAfter(node: Node) {
	const sel = window.getSelection();
	if (!sel) return;
	const range = document.createRange();
	range.setStartAfter(node);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
}

function buildFromTextAndChips(root: HTMLElement, text: string, chips: MentionChip[]) {
	root.replaceChildren();
	const byRef = new Map(chips.map(c => [chipKey(c), c]));
	const re = /@[a-z][a-z0-9_-]*\/[^\s@]+/gi;
	let last = 0;
	let lastChip: HTMLElement | null = null;
	for (const m of text.matchAll(re)) {
		const start = m.index ?? 0;
		const ref = m[0] ?? '';
		if (start > last) root.append(document.createTextNode(text.slice(last, start)));
		const chip = byRef.get(ref) ?? {
			kind: ref.slice(1).split('/')[0] ?? 'file',
			locator: ref.slice(ref.indexOf('/') + 1),
			ref,
			displayName: ref.slice(ref.indexOf('/') + 1)
		};
		lastChip = createChipEl(chip);
		root.append(lastChip);
		last = start + ref.length;
	}
	if (last < text.length) root.append(document.createTextNode(text.slice(last)));
	return lastChip;
}

export const MentionRichInput = forwardRef<MentionRichInputHandle, Props>(
	function MentionRichInput(
		{disabled, placeholder, className, onChange, onKeyDown, onPasteFiles},
		ref
	) {
		const editorRef = useRef<HTMLDivElement>(null);
		const onChangeRef = useRef(onChange);
		onChangeRef.current = onChange;
		const onPasteFilesRef = useRef(onPasteFiles);
		onPasteFilesRef.current = onPasteFiles;
		const showPh = useRef(true);

		const emit = () => {
			const root = editorRef.current;
			if (!root) return;
			const {text, chips} = serialize(root);
			showPh.current = text.length === 0 && chips.length === 0;
			onChangeRef.current?.({text, chips, beforeCaret: plainBeforeCaret(root)});
		};

		const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
			e.preventDefault();
			const plan = planPaste(e.clipboardData);
			if (plan.mode === 'text') {
				editorRef.current?.focus();
				document.execCommand('insertText', false, plan.text);
				emit();
			} else if (plan.mode === 'files') {
				onPasteFilesRef.current?.(plan.files);
			}
		};

		useImperativeHandle(ref, () => ({
			focus: () => editorRef.current?.focus(),
			clear: () => {
				const root = editorRef.current;
				if (!root) return;
				root.replaceChildren();
				showPh.current = true;
				emit();
			},
			snapshot: () => {
				const root = editorRef.current;
				if (!root) return {text: '', chips: [], beforeCaret: ''};
				const {text, chips} = serialize(root);
				return {text, chips, beforeCaret: plainBeforeCaret(root)};
			},
			insertChip: (item: AtItem) => {
				const root = editorRef.current;
				if (!root) return {text: '', chips: [], beforeCaret: ''};
				root.focus();
				const before = plainBeforeCaret(root);
				const full = serialize(root);
				const after = full.text.slice(before.length);
				const span = atQuerySpan(before, before.length);
				const head = span ? before.slice(0, span.start) : before;
				const chip = chipFromAtItem(item);
				const refStr = chip.ref ?? chipKey(chip);
				const nextText = `${head}${refStr} ${after}`;
				const nextChips = mergeChip(full.chips, chip);
				const lastChip = buildFromTextAndChips(root, nextText, nextChips);
				if (lastChip) {
					// Caret after the trailing space following the chip.
					const space = lastChip.nextSibling;
					if (space && space.nodeType === Node.TEXT_NODE) {
						placeCaretAfter(space);
						// Prefer caret at start of space's following content — after chip+space.
						const sel = window.getSelection();
						if (sel && space.textContent && space.textContent.startsWith(' ')) {
							const r = document.createRange();
							r.setStart(space, 1);
							r.collapse(true);
							sel.removeAllRanges();
							sel.addRange(r);
						}
					} else {
						placeCaretAfter(lastChip);
					}
				}
				showPh.current = false;
				const snap = {
					text: nextText,
					chips: nextChips,
					beforeCaret: plainBeforeCaret(root)
				};
				onChangeRef.current?.(snap);
				return snap;
			},
			restore: (text, chips) => {
				const root = editorRef.current;
				if (!root) return;
				buildFromTextAndChips(root, text, chips);
				showPh.current = text.length === 0 && chips.length === 0;
				emit();
			}
		}));

		useEffect(() => {
			const root = editorRef.current;
			if (!root) return;
			const onRemoved = () => emit();
			root.addEventListener('mention-chip-removed', onRemoved);
			return () => root.removeEventListener('mention-chip-removed', onRemoved);
		}, []);

		return (
			<div className="relative w-full">
				<div
					ref={editorRef}
					role="textbox"
					aria-multiline
					aria-placeholder={placeholder}
					contentEditable={!disabled}
					suppressContentEditableWarning
					data-placeholder={placeholder}
					data-slot="input-group-control"
					className={cn(
						'min-h-10 w-full whitespace-pre-wrap break-words px-0 py-1',
						'text-[13px] leading-relaxed text-foreground outline-none',
						'[&:empty]:before:pointer-events-none [&:empty]:before:text-muted-foreground',
						'[&:empty]:before:content-[attr(data-placeholder)]',
						disabled && 'cursor-not-allowed opacity-50',
						className
					)}
					onInput={emit}
					onKeyUp={emit}
					onMouseUp={emit}
					onKeyDown={onKeyDown}
					onPaste={handlePaste}
				/>
			</div>
		);
	}
);
