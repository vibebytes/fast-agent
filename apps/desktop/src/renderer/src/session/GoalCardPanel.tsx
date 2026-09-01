import {shellT as t} from '../i18n/t';
import {useMemo, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import type {GoalCardView} from '../env';

type MemberDraft = {
	name: string;
	role: string;
	brief?: string;
	model?: string;
	max_turns?: number;
	isolation?: string;
};

function parseMembers(json?: string): MemberDraft[] {
	if (!json) return [];
	try {
		const arr = JSON.parse(json) as MemberDraft[];
		return Array.isArray(arr) ? arr.filter(m => typeof m?.name === 'string' && m.name) : [];
	} catch {
		return [];
	}
}

/** Build ConfirmGoal.patchJson from edits; string return = validation error. */
export function buildGoalPatch(
	edits: Record<string, string>
): {patchJson?: string; error?: string} {
	if (Object.keys(edits).length === 0) return {};
	const patch: Record<string, unknown> = {};
	if (edits.statement !== undefined) patch.statement = edits.statement;
	if (edits.acceptance !== undefined) patch.acceptance = edits.acceptance;
	for (const [key, target, err] of [
		['workflow', 'workflow_json', t('shell.goalCard.invalidWorkflowJson')],
		['budget', 'budget_json', t('shell.goalCard.invalidBudgetJson')]
	] as const) {
		const raw = edits[key];
		if (raw !== undefined && raw.trim() !== '') {
			try {
				patch[target] = JSON.parse(raw);
			} catch {
				return {error: err};
			}
		}
	}
	const members = new Map<string, Record<string, unknown>>();
	for (const [key, value] of Object.entries(edits)) {
		if (!key.startsWith('member:')) continue;
		const [, name, field] = key.split(':');
		if (!name || !field) continue;
		const entry = members.get(name) ?? {name};
		if (field === 'max_turns') {
			const n = Number.parseInt(value, 10);
			if (Number.isNaN(n)) return {error: t('shell.goalCard.maxTurnsMustBeNumber', {name})};
			entry.max_turns = n;
		} else {
			entry[field] = value;
		}
		members.set(name, entry);
	}
	if (members.size > 0) patch.members = [...members.values()];
	return {patchJson: JSON.stringify(patch)};
}

/**
 * ②′ Goal card — the ONLY human gate surface in the IDE (same semantics as the TUI card):
 * awaiting_confirm → full-scope draft editing + 确认/取消;
 * started → busy banner (捎话/取消); escalated → Resume/Fail(+捎话); finished → 结案卡.
 */
export function GoalCardPanel({
	card,
	onOpenTeams
}: {
	card: GoalCardView;
	onOpenTeams?: (req: {tab?: 'goals'; goalId?: string}) => void;
}) {
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [steerNote, setSteerNote] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const members = useMemo(() => parseMembers(card.membersJson), [card.membersJson]);

	const setEdit = (key: string, value: string) => setEdits(prev => ({...prev, [key]: value}));

	const onConfirm = () => {
		const {patchJson, error} = buildGoalPatch(edits);
		if (error) { setNotice(error); return; }
		void window.fastIde.confirmGoal(patchJson).then(ok => {
			if (!ok) setNotice(t('shell.goalCard.confirmFailed'));
		});
	};

	const onSteer = () => {
		if (!steerNote.trim()) return;
		void window.fastIde.steerGoal(steerNote.trim()).then(ok => {
			setNotice(ok ? t('shell.goalCard.steerOk') : t('shell.goalCard.steerFailed'));
			if (ok) setSteerNote('');
		});
	};

	const title = {
		awaiting_confirm: t('shell.goalCard.phaseAwaiting'),
		started: t('shell.goalCard.phaseStarted'),
		paused: t('shell.goalCard.phasePaused'),
		escalated: t('shell.goalCard.phaseEscalated'),
		finished: t('shell.goalCard.phaseFinished', {status: card.status})
	}[card.phase];

	const field = (label: string, key: string, value: string, multiline = false) => (
		<label className="flex flex-col gap-1 text-xs">
			<span className="text-muted-foreground">{label}{key in edits ? ' *' : ''}</span>
			{multiline ? (
				<textarea
					className="min-h-14 rounded border bg-background p-1 font-mono text-xs"
					value={edits[key] ?? value}
					onChange={e => setEdit(key, e.target.value)}
				/>
			) : (
				<input
					className="rounded border bg-background p-1 text-xs"
					value={edits[key] ?? value}
					onChange={e => setEdit(key, e.target.value)}
				/>
			)}
		</label>
	);

	return (
		<div
			data-testid="goal-card"
			className="mx-3 mb-2 rounded-lg border border-primary/40 bg-muted/40 p-3 text-sm"
		>
			<div className="flex items-center justify-between">
				<span className="font-semibold">{title}</span>
				<span className="text-xs text-muted-foreground">id: {card.goalId.slice(0, 8)}</span>
			</div>
			{card.name && <p className="mt-1 font-medium">{card.name}</p>}
			{card.statement && <p className="mt-1">{t('shell.goalCard.statement')}：{card.statement}</p>}
			{card.acceptance && <p className="text-xs text-muted-foreground">{t('shell.goalCard.acceptance')}：{card.acceptance}</p>}
			{card.reason && <p className="text-xs text-amber-600">{t('shell.goalCard.reason')}：{card.reason}</p>}
			{card.phase === 'finished' && card.resultSummary && <p className="mt-1">{card.resultSummary}</p>}

			{card.phase === 'awaiting_confirm' && (
				<div className="mt-2 grid grid-cols-2 gap-2">
					{field(t('shell.goalCard.statement'), 'statement', card.statement ?? '')}
					{field(t('shell.goalCard.acceptance'), 'acceptance', card.acceptance ?? '')}
					{field('workflow (JSON)', 'workflow', card.workflowJson ?? '', true)}
					{field('budget (JSON)', 'budget', card.budgetJson ?? '', true)}
					{members.map(m => (
						<div key={m.name} className="col-span-2 grid grid-cols-4 gap-2 rounded border p-2">
							<span className="col-span-4 text-xs font-medium">{m.name}（{m.role}）</span>
							{field('model', `member:${m.name}:model`, m.model ?? '')}
							{field('max_turns', `member:${m.name}:max_turns`, m.max_turns?.toString() ?? '')}
							{field('isolation', `member:${m.name}:isolation`, m.isolation ?? '')}
							{field('brief', `member:${m.name}:brief`, m.brief ?? '')}
						</div>
					))}
				</div>
			)}

			{(card.phase === 'started' || card.phase === 'paused' || card.phase === 'escalated') && (
				<div className="mt-2 flex items-center gap-2">
					<input
						className="flex-1 rounded border bg-background p-1 text-xs"
						placeholder={t('shell.goalCard.steerPlaceholder')}
						value={steerNote}
						onChange={e => setSteerNote(e.target.value)}
					/>
					<Button size="sm" variant="outline" onClick={onSteer}>{t('shell.goalCard.steer')}</Button>
				</div>
			)}

			{notice && <p className="mt-1 text-xs text-muted-foreground">{notice}</p>}

			<div className="mt-2 flex gap-2">
				{card.phase === 'awaiting_confirm' && (
					<>
						<Button size="sm" onClick={onConfirm}>{t('shell.goalCard.confirmStart')}</Button>
						<Button size="sm" variant="outline" onClick={() => void window.fastIde.cancelGoal()}>
							{t('shell.goalCard.cancelGoal')}
						</Button>
					</>
				)}
				{card.phase === 'started' && (
					<Button size="sm" variant="outline" onClick={() => void window.fastIde.cancelGoal()}>
						{t('shell.goalCard.cancelGoal')}
					</Button>
				)}
				{card.phase === 'paused' && (
					<>
						<Button size="sm" onClick={() => void window.fastIde.resumeGoal()}>{t('shell.goalCard.resume')}</Button>
						<Button size="sm" variant="outline" onClick={() => void window.fastIde.cancelGoal()}>
							{t('shell.goalCard.cancelGoal')}
						</Button>
					</>
				)}
				{card.phase === 'escalated' && (
					<>
						<Button size="sm" onClick={() => void window.fastIde.escalateGoal('resume')}>Resume</Button>
						<Button size="sm" variant="destructive" onClick={() => void window.fastIde.escalateGoal('fail')}>
							Fail
						</Button>
					</>
				)}
				{card.phase === 'finished' && (
					<Button size="sm" variant="outline" onClick={() => void window.fastIde.dismissGoalCard()}>
						{t('shell.goalCard.close')}
					</Button>
				)}
				{onOpenTeams ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onOpenTeams({tab: 'goals', goalId: card.goalId})}
					>
						{t('shell.goalCard.openInTeams')}
					</Button>
				) : null}
			</div>
		</div>
	);
}
