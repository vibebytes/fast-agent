import {useLayoutEffect, useState, type RefObject} from 'react';
import type {SlashItem} from '../slashCatalog';

function scrollMenuItemIntoView(list: HTMLElement | null, idx: number): void {
	if (!list || idx < 0) return;
	const el = list.querySelector<HTMLElement>(`[data-menu-idx="${idx}"]`);
	if (!el) return;
	const cRect = list.getBoundingClientRect();
	const eRect = el.getBoundingClientRect();
	if (eRect.top < cRect.top) list.scrollTop -= cRect.top - eRect.top;
	else if (eRect.bottom > cRect.bottom) list.scrollTop += eRect.bottom - cRect.bottom;
}

export function useMenuScroll(args: {
	slashMenuOpen: boolean;
	atMenuOpen: boolean;
	slashHighlight: number;
	atHighlight: number;
	flatSlashLen: number;
	flatAtLen: number;
	selectedSlash: SlashItem | null;
	slashMenuListRef: RefObject<HTMLDivElement | null>;
	atMenuListRef: RefObject<HTMLDivElement | null>;
	slashChipRef: RefObject<HTMLSpanElement | null>;
}): {slashChipIndent: number} {
	const {
		slashMenuOpen,
		atMenuOpen,
		slashHighlight,
		atHighlight,
		flatSlashLen,
		flatAtLen,
		selectedSlash,
		slashMenuListRef,
		atMenuListRef,
		slashChipRef
	} = args;
	const [slashChipIndent, setSlashChipIndent] = useState(0);

	useLayoutEffect(() => {
		if (!slashMenuOpen) return;
		scrollMenuItemIntoView(slashMenuListRef.current, slashHighlight);
	}, [slashHighlight, slashMenuOpen, flatSlashLen]);

	useLayoutEffect(() => {
		if (!atMenuOpen) return;
		scrollMenuItemIntoView(atMenuListRef.current, atHighlight);
	}, [atHighlight, atMenuOpen, flatAtLen]);

	useLayoutEffect(() => {
		if (!selectedSlash) {
			setSlashChipIndent(0);
			return;
		}
		const el = slashChipRef.current;
		if (!el) return;
		const gap = 8;
		const sync = () => setSlashChipIndent(el.offsetWidth + gap);
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	}, [selectedSlash, selectedSlash?.label]);

	return {slashChipIndent};
}
