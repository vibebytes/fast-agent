import type {TimelineItem} from '@fast-ide/session-view';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {VirtualTranscript} from '../VirtualTranscript';

export function ForeignRail({
	items,
	scrollKey,
	taskId,
	bodyLoading,
	stick,
	visible,
	renderItem
}: {
	items: TimelineItem[];
	scrollKey: string;
	taskId: string | null;
	bodyLoading: boolean;
	stick: {current: boolean};
	visible: boolean;
	renderItem: (item: TimelineItem) => ReactNode;
}) {
	const {t} = useTranslation();
	if (items.length === 0) return null;
	return (
		<aside
			data-slot="foreign-rail"
			className="flex min-h-0 w-[min(22rem,38%)] shrink-0 flex-col border-l border-border/50 bg-muted/10"
		>
			<div className="shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground">
				{t('session.foreign.rail')}
			</div>
			<VirtualTranscript
				items={items}
				scrollKey={scrollKey}
				activeTaskId={taskId}
				bodyLoading={bodyLoading}
				stickToBottomRef={stick}
				visible={visible}
				renderItem={renderItem}
				narrow
			/>
		</aside>
	);
}
