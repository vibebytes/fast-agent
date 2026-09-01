import type {ThoughtChrome, TimelineItem} from '@fast-ide/session-view';

function thoughtChromeEqual(a: ThoughtChrome, b: ThoughtChrome): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'duration' && b.kind === 'duration') return a.seconds === b.seconds;
	if (a.kind === 'network' && b.kind === 'network') {
		return (
			a.phase === b.phase && a.attempt === b.attempt && a.maxAttempts === b.maxAttempts
		);
	}
	return true;
}

/** Content equality for memoizing Transcript rows (conversation-perf 02). */
export function timelineItemEqual(a: TimelineItem, b: TimelineItem): boolean {
	if (a === b) return true;
	if (a.kind !== b.kind || a.id !== b.id) return false;
	switch (a.kind) {
		case 'user':
			return (
				b.kind === 'user' &&
				a.text === b.text &&
				a.isCommand === b.isCommand &&
				a.origin === b.origin &&
				Boolean(a.showStop) === Boolean(b.showStop) &&
				(a.planBuild?.planId ?? '') === (b.planBuild?.planId ?? '') &&
				(a.planBuild?.name ?? '') === (b.planBuild?.name ?? '') &&
				JSON.stringify(a.planBuild?.plan?.todos ?? null) ===
					JSON.stringify(b.planBuild?.plan?.todos ?? null)
			);
		case 'assistant':
			return b.kind === 'assistant' && a.text === b.text && a.status === b.status;
		case 'plan':
			return (
				b.kind === 'plan' &&
				a.planId === b.planId &&
				a.name === b.name &&
				a.overview === b.overview &&
				a.body === b.body &&
				a.todos.length === b.todos.length &&
				a.todos.every(
					(t, i) =>
						t.id === b.todos[i]?.id &&
						t.content === b.todos[i]?.content &&
						t.status === b.todos[i]?.status
				)
			);
		case 'thought':
			return (
				b.kind === 'thought' &&
				a.text === b.text &&
				a.open === b.open &&
				thoughtChromeEqual(a.chrome, b.chrome)
			);
		case 'exploring':
			return (
				b.kind === 'exploring' &&
				a.summary === b.summary &&
				a.open === b.open &&
				a.toolIds.length === b.toolIds.length &&
				a.toolIds.every((id, i) => id === b.toolIds[i]) &&
				a.tools.length === b.tools.length &&
				a.tools.every(
					(tool, i) =>
						tool.id === b.tools[i]?.id &&
						tool.tool === b.tools[i]?.tool &&
						tool.title === b.tools[i]?.title &&
						tool.status === b.tools[i]?.status &&
						tool.summary === b.tools[i]?.summary
				)
			);
		case 'processStack':
			return (
				b.kind === 'processStack' &&
				a.stepCount === b.stepCount &&
				a.open === b.open &&
				Boolean(a.cancelled) === Boolean(b.cancelled) &&
				a.steps.length === b.steps.length &&
				a.steps.every((step, i) => {
					const other = b.steps[i];
					return other != null && timelineItemEqual(step, other);
				})
			);
		case 'activity':
			return (
				b.kind === 'activity' &&
				a.summary === b.summary &&
				a.counts.explored === b.counts.explored &&
				a.counts.searched === b.counts.searched &&
				a.counts.fetched === b.counts.fetched &&
				a.counts.edited === b.counts.edited
			);
		case 'file':
			return (
				b.kind === 'file' &&
				a.path === b.path &&
				a.op === b.op &&
				a.status === b.status &&
				a.add === b.add &&
				a.del === b.del &&
				a.hidden === b.hidden &&
				a.lines === b.lines
			);
		case 'tool':
			return (
				b.kind === 'tool' &&
				a.tool === b.tool &&
				a.title === b.title &&
				a.status === b.status &&
				a.output === b.output &&
				a.command === b.command &&
				a.exitCode === b.exitCode &&
				a.summary === b.summary &&
				a.startedAt === b.startedAt
			);
		case 'approval':
			return (
				b.kind === 'approval' &&
				a.tool === b.tool &&
				a.description === b.description &&
				a.risk === b.risk &&
				a.context === b.context &&
				a.note === b.note
			);
		case 'question':
			return (
				b.kind === 'question' &&
				a.title === b.title &&
				a.question === b.question &&
				a.options === b.options &&
				a.allowCustom === b.allowCustom
			);
		case 'question_batch':
			return b.kind === 'question_batch' && a.questions === b.questions;
		case 'system':
			return b.kind === 'system' && a.text === b.text && a.tone === b.tone;
		case 'goalFlow':
			return (
				b.kind === 'goalFlow' &&
				a.goalId === b.goalId &&
				a.phase === b.phase &&
				a.status === b.status &&
				a.label === b.label &&
				a.members.length === b.members.length &&
				a.members.every(
					(m, i) =>
						m.name === b.members[i]?.name &&
						m.status === b.members[i]?.status &&
						m.stepId === b.members[i]?.stepId
				)
			);
		case 'goalStepConclusion':
			return (
				b.kind === 'goalStepConclusion' &&
				a.agentName === b.agentName &&
				a.verdict === b.verdict &&
				a.text === b.text &&
				a.status === b.status
			);
		case 'goalOutcome':
			return (
				b.kind === 'goalOutcome' &&
				a.goalId === b.goalId &&
				a.goalStatus === b.goalStatus &&
				a.text === b.text &&
				a.status === b.status
			);
		default:
			return false;
	}
}
