/**
 * Cold-start gate: Landing until workspace:restored | workspace:restoreFailed, then App shell.
 * Workspace store + push subscription live here so restore Focus Change is applied before shell mount.
 */
import {useTranslation} from 'react-i18next';
import {useEffect, useState} from 'react';
import {App} from './App';
import {ErrorBoundary} from './ErrorBoundary';
import {Landing} from './Landing';
import {reduceShellGate, type ShellGatePhase} from './shellGate';
import {createWorkspaceStore} from './workspaceStore';
import {subscribeWorkspacePush} from './workspaceWire';

export function Bootstrap() {
	const {t} = useTranslation();
	const [store] = useState(() => createWorkspaceStore());
	const [phase, setPhase] = useState<ShellGatePhase>('landing');

	useEffect(() => subscribeWorkspacePush(store), [store]);

	useEffect(() => {
		const offOk = window.fastIde.onWorkspaceRestored(() => {
			setPhase(p => reduceShellGate(p, {type: 'workspace:restored'}));
		});
		const offFail = window.fastIde.onWorkspaceRestoreFailed(payload => {
			setPhase(p =>
				reduceShellGate(p, {type: 'workspace:restoreFailed', reason: payload.reason})
			);
		});

		void window.fastIde.checkRestoreState().then(res => {
			if (res.done) {
				if (res.failed) {
					setPhase(p =>
						reduceShellGate(p, {
							type: 'workspace:restoreFailed',
							reason: res.reason ?? 'Engine error'
						})
					);
				} else {
					setPhase(p => reduceShellGate(p, {type: 'workspace:restored'}));
				}
			}
		});

		return () => {
			offOk();
			offFail();
		};
	}, []);

	if (phase === 'landing') return <Landing />;
	return (
		<ErrorBoundary label={t('shell.boundary.workbench')}>
			<App store={store} />
		</ErrorBoundary>
	);
}
