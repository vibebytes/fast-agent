import type {TimelineItem} from '@fast-ide/session-view';
import {Card, CardContent, CardHeader, CardTitle} from '@fast-ide/ui/components/card';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, LoaderCircle, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

export type SubagentCardChrome = {
	tone: 'running' | 'idle' | 'ended' | 'success' | 'failed' | 'cancelled';
	statusLabel: string;
	showCheck: boolean;
	showCross: boolean;
};

/** Last N lines of a plain-text process tail. Empty input stays empty. */
export function subagentPreviewLines(raw: string | undefined, maxLines = 12): string {
	if (!raw) return '';
	const lines = raw.split(/\r?\n/);
	const trimmed = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
	return trimmed.slice(-maxLines).join('\n');
}

/** Live Finished paints a check/cross. Cold inactive never does. */
export function subagentCardChrome(item: {
	mode: string;
	activity: string;
	status?: string;
}): SubagentCardChrome {
	if (item.status === 'completed')
		return {tone: 'success', statusLabel: '已完成', showCheck: true, showCross: false};
	if (item.status === 'failed')
		return {tone: 'failed', statusLabel: '失败', showCheck: false, showCross: true};
	if (item.status === 'cancelled')
		return {tone: 'cancelled', statusLabel: '已取消', showCheck: false, showCross: false};
	if (item.activity === 'running')
		return {tone: 'running', statusLabel: '运行中', showCheck: false, showCross: false};
	if (item.mode === 'continuable')
		return {tone: 'idle', statusLabel: '空闲', showCheck: false, showCross: false};
	return {tone: 'ended', statusLabel: '已结束', showCheck: false, showCross: false};
}

export function SubagentWorkCard({item}: {item: Extract<TimelineItem, {kind: 'subagent'}>}) {
	const {t} = useTranslation();
	const chrome = subagentCardChrome(item);
	const title = item.label.trim() || t('shell.subagent.untitled');
	const preview = subagentPreviewLines(item.preview, 12);
	return (
		<Card className="border-border/60 bg-card/80">
			<CardHeader className="flex flex-row items-center gap-2 space-y-0 py-3">
				{chrome.tone === 'running' ? (
					<LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
				) : chrome.showCheck ? (
					<Check className="size-4 shrink-0 text-emerald-500" />
				) : chrome.showCross ? (
					<X className="size-4 shrink-0 text-destructive" />
				) : null}
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
			</CardHeader>
			<CardContent className="pb-3 pt-0">
				<p
					className={cn(
						'text-xs',
						chrome.tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
						chrome.tone === 'failed' && 'text-destructive',
						(chrome.tone === 'ended' || chrome.tone === 'idle' || chrome.tone === 'cancelled') &&
							'text-muted-foreground'
					)}
				>
					{chrome.statusLabel}
				</p>
				{item.summary ? (
					<p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
				) : null}
				{preview ? (
					<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
						{preview}
					</pre>
				) : null}
			</CardContent>
		</Card>
	);
}
