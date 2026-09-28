import {useCallback, useEffect, useState} from 'react';
import type {ConfigurableTool, PutConfigurableToolInput} from '@fast-ide/session-view';

export type ToolsStatus = 'loading' | 'ready' | 'error' | 'disabled';

type ToolsApi = {
	listConfigurableTools: () => Promise<{ok: true; tools: ConfigurableTool[]} | {ok: false; notice: string}>;
	putConfigurableTool: (
		input: PutConfigurableToolInput
	) => Promise<{ok: true; tool: ConfigurableTool} | {ok: false; notice: string}>;
};

export function useConfigurableTools(engineReady: boolean, api: ToolsApi = window.fastIde) {
	const [status, setStatus] = useState<ToolsStatus>(engineReady ? 'loading' : 'disabled');
	const [tools, setTools] = useState<ConfigurableTool[]>([]);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!engineReady) {
			setStatus('disabled');
			setTools([]);
			return;
		}
		setStatus(prev => (prev === 'ready' ? prev : 'loading'));
		const res = await api.listConfigurableTools();
		if (!res.ok) {
			setStatus('error');
			setNotice(res.notice);
			return;
		}
		setTools(res.tools);
		setStatus('ready');
		setNotice(null);
	}, [api, engineReady]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = useCallback(
		async (input: PutConfigurableToolInput) => {
			const res = await api.putConfigurableTool(input);
			if (!res.ok) {
				setNotice(res.notice);
				await load();
				return false;
			}
			await load();
			return true;
		},
		[api, load]
	);

	return {status, tools, notice, retry: load, save, engineReady};
}
