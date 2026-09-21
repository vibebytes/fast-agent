import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown, Clock, Pause, Play, Square} from 'lucide-react';
import {shellT} from '../i18n/t';
import {goalStatusChipClass, goalStatusLabel, roleLabel, shortId} from '../teamsDisplay';
import {WorkflowReadonly} from '../WorkflowReadonly';
import {agentPrompt, projectChip, type AgentRow, type TeamRow} from './rows';

export function GoalDetail(p: Record<string, any>) {
	const {
		selectedGoal, teams, agents, teamNameById, workflowSteps, progress, budget,
		actionBusy, steerNote, setSteerNote, scheduleCron, setScheduleCron, scheduleTz, setScheduleTz,
		expandedMemberId, setExpandedMemberId, goalAction, onSteer, onScheduleGoal, onDeleteGoal,
		onOpenLivingSession, onInsertMention, openWorkflowAgent, setTab, setSelectedTeamId
	} = p;
	const terminalGoal = (st: string) =>
		['passed', 'failed', 'cancelled', 'discarded', 'succeeded'].includes(st);
	return (
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{selectedGoal.name?.trim() || shortId(selectedGoal.id, 8)}
									</h2>
									<span
										className={cn(
											'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
											goalStatusChipClass(selectedGoal.status)
										)}
									>
										{goalStatusLabel(selectedGoal.status)}
									</span>
								</div>
								{selectedGoal.statement &&
								selectedGoal.statement.trim() !== selectedGoal.name?.trim() ? (
									<p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground line-clamp-3">
										{selectedGoal.statement}
									</p>
								) : null}
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedGoal.projectId, selectedGoal.projectDisplayName)}
									{selectedGoal.teamId ? (
										<>
											{' · '}
											<button
												type="button"
												className="underline-offset-2 hover:underline"
												onClick={() => {
													setSelectedTeamId(selectedGoal.teamId!);
													setTab('teams');
												}}
											>
												{shellT('shell.teams.teamLink', {name: teamNameById.get(selectedGoal.teamId) ?? shellT('shell.teams.view')})}
											</button>
										</>
									) : null}
								</p>
							</header>

							{(() => {
								const goalTeam = selectedGoal.teamId
									? teams.find((t: TeamRow) => t.id === selectedGoal.teamId)
									: null;
								const members = goalTeam?.members ?? [];
								if (members.length === 0) return null;
								return (
									<section className="space-y-2">
										<div className="flex items-baseline justify-between gap-2">
											<h3 className="text-[13px] font-semibold">{shellT('shell.teams.members')}</h3>
											<span className="text-[11px] text-muted-foreground">
												{shellT('shell.teams.membersHint', {count: members.length})}
											</span>
										</div>
										<ul className="overflow-hidden rounded-xl border border-border">
											{members.map((m: NonNullable<TeamRow['members']>[number], mi: number) => {
												const agent = agents.find((a: AgentRow) => a.id === m.agentId);
												const open = expandedMemberId === m.agentId;
												const prompt = agentPrompt(agent);
												return (
													<li
														key={m.agentId}
														className={cn(
															mi > 0 && 'border-t border-border',
															open && 'bg-muted/20'
														)}
													>
														<button
															type="button"
															className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
															onClick={() =>
																setExpandedMemberId(open ? null : m.agentId)
															}
															aria-expanded={open}
														>
															<span className="font-medium">{m.name}</span>
															<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
																{roleLabel(m.teamRole)}
															</span>
															{(prompt.model || agent?.model) && (
																<span className="truncate text-[11px] text-muted-foreground">
																	{prompt.model || agent?.model}
																</span>
															)}
															<ChevronDown
																className={cn(
																	'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
																	open && 'rotate-180'
																)}
															/>
														</button>
														{open ? (
															<div className="space-y-2 border-t border-border/60 px-3 py-2.5 text-[12px]">
																{agent?.taskBrief ? (
																	<div>
																		<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																			{shellT('shell.teams.taskBrief')}
																		</div>
																		<p className="whitespace-pre-wrap leading-relaxed">
																			{agent.taskBrief}
																		</p>
																	</div>
																) : null}
																<div>
																	<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																		{shellT('shell.teams.systemPrompt')}
																	</div>
																	{prompt.systemPrompt ? (
																		<pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
																			{prompt.systemPrompt}
																		</pre>
																	) : (
																		<p className="text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
																	)}
																</div>
															</div>
														) : null}
													</li>
												);
											})}
										</ul>
									</section>
								);
							})()}

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">Workflow</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.topologyReadonly')}</span>
								</div>
								<WorkflowReadonly
									steps={workflowSteps}
									mode="live"
									currentStepIds={selectedGoal.currentStepIds}
									currentStepId={selectedGoal.currentStepId}
									completedSteps={progress.completedSteps}
									pendingExtras={progress.pendingExtras}
									goalStatus={selectedGoal.status}
									goalLabel={selectedGoal.name?.trim() || undefined}
									resultLabel={
										['passed', 'succeeded', 'failed', 'cancelled', 'discarded'].includes(
											selectedGoal.status
										)
											? goalStatusLabel(selectedGoal.status)
											: undefined
									}
									onOpenStep={use => openWorkflowAgent(use, selectedGoal.teamId)}
								/>
							</section>

							{(selectedGoal.status === 'running' ||
								selectedGoal.status === 'paused' ||
								selectedGoal.status === 'blocked') && (
								<section className="space-y-2 rounded-xl border border-border px-3 py-3">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.runControls')}</h3>
									<div className="flex flex-wrap gap-2">
										{selectedGoal.status === 'running' ? (
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={actionBusy}
												onClick={() => void goalAction('pause', selectedGoal.id)}
											>
												<Pause className="size-3.5" />
												{shellT('shell.teams.pause')}
											</Button>
										) : selectedGoal.status === 'paused' ? (
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={actionBusy}
												onClick={() => void goalAction('resume', selectedGoal.id)}
											>
												<Play className="size-3.5" />
												{shellT('shell.teams.continue')}
											</Button>
										) : null}
										{(selectedGoal.status === 'running' ||
											selectedGoal.status === 'paused') && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={actionBusy}
												onClick={() => {
													if (window.confirm(shellT('shell.teams.stopConfirm')))
														void goalAction('cancel', selectedGoal.id);
												}}
											>
												<Square className="size-3.5" />
												{shellT('shell.teams.stop')}
											</Button>
										)}
									</div>
									<div className="flex items-center gap-2">
										<input
											className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-xs"
											placeholder={shellT('shell.teams.steerPlaceholder')}
											value={steerNote}
											onChange={e => setSteerNote(e.target.value)}
										/>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={actionBusy || !steerNote.trim()}
											onClick={() => void onSteer(selectedGoal.id)}
										>
											{shellT('shell.teams.send')}
										</Button>
									</div>
								</section>
							)}

							{(budget.length > 0 || selectedGoal.confirmedAt) && (
								<details className="group rounded-xl border border-border">
									<summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
										<span className="group-open:text-foreground">{shellT('shell.teams.moreSettings')}</span>
										<span className="ml-2 text-[11px] font-normal">{shellT('shell.teams.usageSchedule')}</span>
									</summary>
									<div className="space-y-4 border-t border-border px-3 py-3">
										{budget.length > 0 ? (
											<div>
												<div className="mb-2 text-[11px] font-medium text-muted-foreground">
													{shellT('shell.teams.resourceUsage')}
												</div>
												<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
													{budget.map((row: {label: string; value: string}) => (
														<div key={row.label}>
															<dt className="text-muted-foreground">{row.label}</dt>
															<dd className="font-medium tabular-nums">{row.value}</dd>
														</div>
													))}
												</dl>
											</div>
										) : null}
										{selectedGoal.confirmedAt ? (
											<div className="space-y-2 text-xs">
												<div className="flex items-center gap-1.5 font-medium text-muted-foreground">
													<Clock className="size-3.5" />
													{shellT('shell.teams.repeatSchedule')}
												</div>
												<div className="flex flex-wrap items-end gap-2">
													<label className="flex flex-col gap-0.5">
														<span className="text-muted-foreground">{shellT('shell.teams.scheduleLabel')}</span>
														<input
															className="h-8 rounded border px-2 font-mono"
															value={scheduleCron}
															onChange={e => setScheduleCron(e.target.value)}
															title={shellT('shell.teams.cronTitle')}
														/>
													</label>
													<label className="flex flex-col gap-0.5">
														<span className="text-muted-foreground">{shellT('shell.teams.timezone')}</span>
														<input
															className="h-8 rounded border px-2"
															value={scheduleTz}
															onChange={e => setScheduleTz(e.target.value)}
														/>
													</label>
													<Button
														type="button"
														size="sm"
														variant="secondary"
														disabled={actionBusy}
														onClick={() => void onScheduleGoal(selectedGoal)}
													>
														{shellT('shell.teams.create')}
													</Button>
												</div>
												<p className="text-muted-foreground">
													{shellT('shell.teams.scheduleHint')}
												</p>
											</div>
										) : null}
									</div>
								</details>
							)}

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{selectedGoal.originSessionId && onOpenLivingSession ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onOpenLivingSession(
												selectedGoal.originSessionId!,
												selectedGoal.projectId
											)
										}
									>
										{shellT('shell.teams.openInChat')}
									</Button>
								) : null}
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										variant={
											selectedGoal.originSessionId && onOpenLivingSession
												? 'secondary'
												: 'default'
										}
										onClick={() =>
											onInsertMention(
												'goal',
												selectedGoal.id,
												selectedGoal.name?.trim() || undefined,
												selectedGoal.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{terminalGoal(selectedGoal.status) ? (
									<Button
										type="button"
										size="xs"
										variant="outline"
										className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
										disabled={actionBusy}
										onClick={() => void onDeleteGoal(selectedGoal)}
									>
										{shellT('shell.teams.delete')}
									</Button>
								) : null}
							</footer>
						</div>

	);
}
