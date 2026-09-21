import type {FormEvent, KeyboardEvent} from 'react';
import {exactAtMatch, type AtItem} from '../atCatalog';
import {exactSlashMatch, type SlashItem} from '../slashCatalog';

export function handleComposerKeyDown(
	e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>,
	ctx: {
		slashMenuOpen: boolean;
		flatSlashMenu: SlashItem[];
		slashHighlight: number;
		setSlashHighlight: (updater: (i: number) => number) => void;
		slashQ: string | null;
		pickSlash: (item: SlashItem) => void;
		atMenuOpen: boolean;
		flatAtMenu: AtItem[];
		atHighlight: number;
		setAtHighlight: (updater: (i: number) => number) => void;
		atQ: string | null;
		pickAt: (item: AtItem) => void;
		selectedSlash: SlashItem | null;
		draft: string;
		clearSlashChip: () => void;
		onSubmit: (event: FormEvent) => void;
	}
): void {
	if (ctx.slashMenuOpen && ctx.flatSlashMenu.length > 0) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			ctx.setSlashHighlight(i => (i + 1) % ctx.flatSlashMenu.length);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			ctx.setSlashHighlight(i => (i - 1 + ctx.flatSlashMenu.length) % ctx.flatSlashMenu.length);
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const item = ctx.flatSlashMenu[ctx.slashHighlight] ?? ctx.flatSlashMenu[0];
			if (item) ctx.pickSlash(item);
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const item =
				exactSlashMatch(ctx.slashQ ?? '', ctx.flatSlashMenu) ??
				ctx.flatSlashMenu[ctx.slashHighlight] ??
				ctx.flatSlashMenu[0];
			if (item) ctx.pickSlash(item);
			return;
		}
	}

	if (ctx.atMenuOpen && ctx.flatAtMenu.length > 0) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			ctx.setAtHighlight(i => (i + 1) % ctx.flatAtMenu.length);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			ctx.setAtHighlight(i => (i - 1 + ctx.flatAtMenu.length) % ctx.flatAtMenu.length);
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const item = ctx.flatAtMenu[ctx.atHighlight] ?? ctx.flatAtMenu[0];
			if (item) ctx.pickAt(item);
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const item =
				exactAtMatch(ctx.atQ ?? '', ctx.flatAtMenu) ?? ctx.flatAtMenu[ctx.atHighlight] ?? ctx.flatAtMenu[0];
			if (item) ctx.pickAt(item);
			return;
		}
	}

	if (
		ctx.selectedSlash &&
		(e.key === 'Backspace' || e.key === 'Delete') &&
		ctx.draft.length === 0 &&
		!e.metaKey &&
		!e.ctrlKey
	) {
		e.preventDefault();
		ctx.clearSlashChip();
		return;
	}

	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		void ctx.onSubmit(e as unknown as FormEvent);
	}
}
