import React, {createContext, useContext, useMemo} from 'react';
import type {SemanticTheme, ThemeName} from '../theme/semanticTheme.js';
import {resolveTheme, applyTerminalBackground} from '../theme/semanticTheme.js';

export type ThemeContextValue = {
	theme: SemanticTheme;
	themeName: ThemeName;
	setThemeName: (name: ThemeName) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
	theme: resolveTheme('default-dark'),
	themeName: 'default-dark',
	setThemeName: () => {}
});

export function useTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}

export function ThemeProvider({children, themeName, setThemeName, terminalBackground}: {
	children: React.ReactNode;
	themeName: ThemeName;
	setThemeName: (name: ThemeName) => void;
	/** 6‑digit hex colour of the terminal's actual background (OSC 11). */
	terminalBackground?: string;
}) {
	const theme = useMemo(
		() => applyTerminalBackground(resolveTheme(themeName), terminalBackground),
		[themeName, terminalBackground],
	);
	return (
		<ThemeContext.Provider value={{theme, themeName, setThemeName}}>
			{children}
		</ThemeContext.Provider>
	);
}
