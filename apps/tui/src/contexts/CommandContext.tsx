import React, {createContext, useContext} from 'react';
import type {CommandRegistry} from '../commands/registry.js';

export type CommandContextValue = {
	registry: CommandRegistry;
};

export const CommandContext = createContext<CommandContextValue | undefined>(undefined);

export function useCommandRegistry(): CommandRegistry {
	const ctx = useContext(CommandContext);
	if (!ctx) throw new Error('useCommandRegistry must be used within CommandContext');
	return ctx.registry;
}

export function CommandProvider({registry, children}: {registry: CommandRegistry; children: React.ReactNode}) {
	return <CommandContext.Provider value={{registry}}>{children}</CommandContext.Provider>;
}
