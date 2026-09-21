import {useEffect, useMemo, useState} from 'react';
import type {SlashCatalogEntry} from '../env';
import type {EngineKindName} from '../enginePicker';
import {
	filterSlashMenu,
	flattenSlashMenu,
	HOST_SLASH_COMMANDS,
	skillsFromCatalog,
	type SlashItem,
	type SlashMenuGroups
} from '../slashCatalog';

export function useSlashCatalog(args: {
	slashRows: SlashCatalogEntry[];
	slashQ: string | null;
	engineKind: EngineKindName;
	slashMenuOpen: boolean;
	slashHydrated: boolean;
}): {
	skills: SlashItem[];
	slashMenuGroups: SlashMenuGroups;
	slashSkillsEmpty: boolean;
	flatSlashMenu: SlashItem[];
	skillsTimedOut: boolean;
} {
	const {slashRows, slashQ, engineKind, slashMenuOpen, slashHydrated} = args;
	const [skillsTimedOut, setSkillsTimedOut] = useState(false);
	const skills = useMemo(() => skillsFromCatalog(slashRows), [slashRows]);
	const slashMenuGroups = useMemo(
		() =>
			slashQ === null
				? {commands: [], platform: [], coding: [], external: []}
				: filterSlashMenu(slashQ, skills, engineKind === 'dsh' ? [] : HOST_SLASH_COMMANDS),
		[slashQ, skills, engineKind]
	);
	const slashSkillsEmpty =
		slashMenuGroups.platform.length === 0 &&
		slashMenuGroups.coding.length === 0 &&
		slashMenuGroups.external.length === 0;
	const flatSlashMenu = useMemo(() => flattenSlashMenu(slashMenuGroups), [slashMenuGroups]);

	useEffect(() => {
		if (!slashMenuOpen) return;
		setSkillsTimedOut(false);
		void window.fastIde.requestSlashCatalog();
		const timer = window.setTimeout(() => setSkillsTimedOut(true), 8_000);
		return () => window.clearTimeout(timer);
	}, [slashMenuOpen]);

	useEffect(() => {
		if (slashHydrated || slashRows.length > 0) setSkillsTimedOut(false);
	}, [slashHydrated, slashRows.length]);

	return {skills, slashMenuGroups, slashSkillsEmpty, flatSlashMenu, skillsTimedOut};
}
