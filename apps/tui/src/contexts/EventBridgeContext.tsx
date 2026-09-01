import React, {createContext, useContext} from 'react';
import type {AgentProcess} from '../rpc/AgentProcess.js';

export type EventBridgeContextValue = {
	agent: AgentProcess;
};

export const EventBridgeContext = createContext<EventBridgeContextValue | undefined>(undefined);

export function useEventBridge(): EventBridgeContextValue {
	const ctx = useContext(EventBridgeContext);
	if (!ctx) throw new Error('useEventBridge must be used within EventBridgeContext');
	return ctx;
}

export function EventBridgeProvider({agent, children}: {agent: AgentProcess; children: React.ReactNode}) {
	return <EventBridgeContext.Provider value={{agent}}>{children}</EventBridgeContext.Provider>;
}
