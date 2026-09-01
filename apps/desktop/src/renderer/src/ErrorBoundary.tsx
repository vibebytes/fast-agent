import {Component, type ReactNode} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {shellT as t} from './i18n/t';

export type BoundaryFallback = {
	error: Error;
	/** Remount the failed subtree (state inside it is lost). */
	retry: () => void;
};

type Props = {
	/** Surface label shown in the fallback (e.g. "会话区", "Files"). */
	label: string;
	children: ReactNode;
	/** Optional custom fallback; default is a compact retry card. */
	fallback?: (f: BoundaryFallback) => ReactNode;
};

type State = {error: Error | null; epoch: number};

export function boundaryStateAfterError(prev: State, error: Error): State {
	return {error, epoch: prev.epoch};
}

export function boundaryStateAfterRetry(prev: State): State {
	return {error: null, epoch: prev.epoch + 1};
}

/**
 * Fault isolation (perf doc P1-8 / 4.1): one crashing pane must not white-screen
 * the whole renderer. Mount one per independent surface (SessionPane, each
 * RailTab pane, Sidebar, Teams) — the crash stays inside that surface with a
 * local retry that remounts only the failed subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
	override state: State = {error: null, epoch: 0};

	static getDerivedStateFromError(error: Error): Partial<State> {
		return {error};
	}

	override componentDidCatch(error: Error, info: {componentStack?: string | null}): void {
		console.error(`[boundary:${this.props.label}]`, error, info.componentStack ?? '');
	}

	private retry = (): void => {
		this.setState(prev => boundaryStateAfterRetry(prev));
	};

	override render(): ReactNode {
		const {error, epoch} = this.state;
		if (error) {
			if (this.props.fallback) return this.props.fallback({error, retry: this.retry});
			return (
				<div className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-2 p-4 text-center">
					<p className="text-[13px] font-medium text-foreground">
						{t('shell.errorBoundary.crashed', {label: this.props.label})}
					</p>
					<p className="max-w-sm truncate text-xs text-muted-foreground" title={error.message}>
						{error.message}
					</p>
					<Button type="button" size="sm" variant="secondary" onClick={this.retry}>
						{t('shell.errorBoundary.reload')}
					</Button>
				</div>
			);
		}
		// epoch key remounts the subtree after retry.
		return <div key={epoch} className="contents">{this.props.children}</div>;
	}
}
