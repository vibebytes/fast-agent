import {memo, type ReactNode} from 'react';
import {type DshCaps, type TimelineItem} from '@fast-ide/session-view';
import {Bubble, BubbleContent} from '@fast-ide/ui/components/bubble';
import {Message, MessageContent} from '@fast-ide/ui/components/message';
import {cn} from '@fast-ide/ui/lib/utils';
import {ErrorCardRow} from './ErrorCardRow';
import {useTranslation} from 'react-i18next';
import type {WorkspaceStore} from '../workspaceStore';
import {timelineItemEqual} from '../timelineItemEqual';
import {OpenFileContext, StreamingMarkdownMessage} from '../MarkdownMessage';
import {ToolCard} from '../ToolCard';
import {DshToolCard} from '../dsh/tools/DshToolCard';
import {shouldHideToolItem} from '../toolPresentation';
import {FileEditCard} from './FileEditCard';
import {QuestionBatchCard} from './QuestionBatchCard';
import {SubagentWorkCard} from './SubagentWorkCard';
import {PlanCard} from './PlanCard';
import {ApprovalCard, QuestionCard} from './DecisionCards';
import {
	ContextInjectionChrome,
	GoalFlowChrome,
	GoalOutcomeChrome,
	GoalStepConclusionChrome
} from './GoalChrome';
import {ExploringCollapsible, ProcessStackView, ThoughtCollapsible} from './ThoughtChrome';
import {MessageStopHost, SlashChip, UserBubble} from './UserBubble';

export type TimelineRowProps = {
	item: TimelineItem;
	/** Task-local key for Decision Transition records. */
	decisionScope: string;
	canCancel: boolean;
	showUserStop: boolean;
	onOpenFile?: (path: string, line?: number, endLine?: number) => void;
	/** PlanIds with an in-flight PlanBuild turn (PlanCard Building…). */
	buildActivePlanIds?: Set<string>;
	/** DSH respond is allow-once / reject only — hide Fast "Always allow". */
	engineKind?: 'fast' | 'dsh';
	/** P3 error-card Retry — reruns the failed run (engine RerunRun). */
	onRerun?: (runId: string) => void;
	/** P3 error-card Continue — sends a fresh plain-message run. */
	onContinueRun?: () => void;
	/** D10 regenerate — reruns the last completed answer (hover ↻ entry). */
	onRegenerate?: (runId: string) => void;
	/** D10 stale state machine — this assistant row's error card has a newer terminal. */
	errorStale?: boolean;
	/** D10 regenerate hover entry — id of the user row whose answer is the last completed one (session idle). */
	regenUserId?: string | null;
	/** A run is active in this Session — disables card actions. */
	runBusy?: boolean;
	/** Error-card Retry is in flight — not the same as composer canCancel. */
	retryBusy?: boolean;
	/** Session store — subagent rows subscribe for live child transcript tails. */
	store?: WorkspaceStore;
	/** DSH caps — `delta.childTranscript` gates the live tail. */
	dshCaps?: DshCaps;
};

export const TimelineRow = memo(function TimelineRow({
	item,
	decisionScope,
	canCancel,
	showUserStop,
	onOpenFile,
	buildActivePlanIds,
	engineKind = 'fast',
	onRerun,
	onContinueRun,
	onRegenerate,
	errorStale,
	regenUserId,
	runBusy,
	retryBusy,
	store,
	dshCaps
}: TimelineRowProps) {
	const {t} = useTranslation();
	let body: ReactNode = null;

	switch (item.kind) {
		case 'user': {
			const regen =
				!runBusy && regenUserId === item.id && item.runId && onRegenerate
					? {
							runId: item.runId,
							label: t('session.rerun.regenerateAction'),
							onRegenerate
						}
					: undefined;
			body = item.isCommand ? (
				<SlashChip text={item.text} canCancel={showUserStop} regen={regen} />
			) : (
				<UserBubble
					text={item.text}
					canCancel={showUserStop}
					regen={regen}
					scheduled={item.origin === 'scheduler_generated'}
					wake={item.origin === 'background_wake'}
					dockedBelow={Boolean(item.planBuild)}
					images={item.images}
				/>
			);
			break;
		}
		case 'thought':
			body = <ThoughtCollapsible item={item} />;
			break;
		case 'exploring':
			body = <ExploringCollapsible item={item} />;
			break;
		case 'processStack':
			body = <ProcessStackView item={item} />;
			break;
		case 'activity':
			body = <p className="text-[13px] text-muted-foreground">{item.summary}</p>;
			break;
		case 'goalFlow':
			body = <GoalFlowChrome item={item} t={t} />;
			break;
		case 'goalStepConclusion':
			body = <GoalStepConclusionChrome item={item} t={t} />;
			break;
		case 'goalOutcome':
			body = <GoalOutcomeChrome item={item} t={t} />;
			break;
		case 'file':
			body =
				item.status === 'running' ? (
					<MessageStopHost canCancel={canCancel} className="w-full">
						<FileEditCard item={item} onOpenFile={onOpenFile} />
					</MessageStopHost>
				) : (
					<FileEditCard item={item} onOpenFile={onOpenFile} />
				);
			break;
		case 'tool':
			if (shouldHideToolItem(item)) break;
			body =
				item.status === 'running' ? (
					<MessageStopHost canCancel={canCancel} className="w-full">
						{item.dshCard ? (
							<DshToolCard card={{...item.dshCard, status: item.status}} />
						) : (
							<ToolCard item={item} />
						)}
					</MessageStopHost>
				) : item.dshCard ? (
					<DshToolCard card={{...item.dshCard, status: item.status}} />
				) : (
					<ToolCard item={item} />
				);
			break;
		case 'assistant':
			// Activity is signaled by shimmer on the running card header / latest
			// collapsed process line — never a standalone thinking row.
			body =
				item.status === 'error' && (item.fault || (item.text ?? '').trim()) ? (
					<ErrorCardRow
						fault={item.fault}
						text={item.text}
						runId={item.runId ?? item.id}
						busy={Boolean(retryBusy)}
						stale={errorStale === true}
						canRerun={engineKind !== 'dsh' || dshCaps?.rerun === true}
						onRetry={runId => onRerun?.(runId)}
						onContinue={() => onContinueRun?.()}
					/>
				) : item.text ? (
					<div className="group relative">
						<Message align="start">
							<MessageContent>
								<Bubble variant="ghost" align="start">
									<BubbleContent className="text-[13.5px] leading-[1.65]">
								<StreamingMarkdownMessage
									text={item.text}
									streaming={item.status === 'streaming'}
								/>
								</BubbleContent>
							</Bubble>
						</MessageContent>
					</Message>
				</div>
			) : null;
			break;
		case 'plan':
			body = <PlanCard item={item} buildActive={buildActivePlanIds?.has(item.planId)} />;
			break;
		case 'system':
			body = (
				<p
					className={cn(
						'text-[13px]',
						item.tone === 'error' && 'text-destructive',
						item.tone === 'cancelled' && 'text-muted-foreground',
						item.tone === 'info' && 'font-mono text-muted-foreground'
					)}
				>
					{item.text}
				</p>
			);
			break;
		case 'approval':
			body = <ApprovalCard item={item} scope={decisionScope} engineKind={engineKind} />;
			break;
		case 'question':
			body = <QuestionCard item={item} scope={decisionScope} />;
			break;
		case 'question_batch':
			body = <QuestionBatchCard item={item} scope={decisionScope} />;
			break;
		case 'subagent':
			body = (
				<SubagentWorkCard
					item={item}
					store={store}
					taskId={decisionScope}
					caps={dshCaps?.delta}
				/>
			);
			break;
		case 'contextInjection':
			body = <ContextInjectionChrome item={item} />;
			break;
		default:
			body = null;
	}

	// User prompt keeps full column width; reply stream is slightly narrower paper column.
	if (item.kind === 'user' || body == null) return body;
	return (
		<OpenFileContext.Provider value={onOpenFile}>
			<div className="relative z-0 mx-auto w-[calc(100%-2.5rem)] min-w-0 max-w-[calc(100%-2.5rem)] shrink-0 self-center">
				{body}
			</div>
		</OpenFileContext.Provider>
	);
}, timelineRowPropsEqual);

/** Memo comparator — exported so the perf harness probe counts with the production contract. */
export function timelineRowPropsEqual(
	prev: TimelineRowProps,
	next: TimelineRowProps
): boolean {
	return (
		prev.decisionScope === next.decisionScope &&
		prev.canCancel === next.canCancel &&
		prev.showUserStop === next.showUserStop &&
		prev.onOpenFile === next.onOpenFile &&
		prev.buildActivePlanIds === next.buildActivePlanIds &&
		prev.engineKind === next.engineKind &&
		prev.onRerun === next.onRerun &&
		prev.onContinueRun === next.onContinueRun &&
		prev.onRegenerate === next.onRegenerate &&
		prev.errorStale === next.errorStale &&
		prev.regenUserId === next.regenUserId &&
		prev.runBusy === next.runBusy &&
		prev.retryBusy === next.retryBusy &&
		prev.store === next.store &&
		prev.dshCaps === next.dshCaps &&
		timelineItemEqual(prev.item, next.item)
	);
}
