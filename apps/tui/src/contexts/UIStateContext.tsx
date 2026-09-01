import React, {createContext, useContext} from 'react';
import type {UiState} from '../state/model.js';
import type {UiAction} from '../state/reducer.js';

export type UIStateContextValue = {
	state: UiState;
	dispatch: React.Dispatch<UiAction>;
};

export const UIStateContext = createContext<UIStateContextValue | undefined>(undefined);

export function useUIState(): UIStateContextValue {
	const ctx = useContext(UIStateContext);
	if (!ctx) throw new Error('useUIState must be used within UIStateContext');
	return ctx;
}
