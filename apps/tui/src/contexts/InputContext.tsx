import React, {createContext, useContext} from 'react';
import type {InputMode} from '../state/model.js';
import type {SuggestionState} from '../suggestions/SuggestionEngine.js';

export type InputContextValue = {
	mode: InputMode;
	history: string[];
	historyEnabled: boolean;
	suggestions: SuggestionState;
	reverseSearchActive: boolean;
};

export const InputContext = createContext<InputContextValue>({
	mode: 'normal',
	history: [],
	historyEnabled: true,
	suggestions: {groups: [], activeIndex: 0, visible: false},
	reverseSearchActive: false
});

export function useInputContext(): InputContextValue {
	return useContext(InputContext);
}

export function InputProvider({value, children}: {value: InputContextValue; children: React.ReactNode}) {
	return <InputContext.Provider value={value}>{children}</InputContext.Provider>;
}
