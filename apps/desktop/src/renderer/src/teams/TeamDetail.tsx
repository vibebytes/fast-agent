import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown} from 'lucide-react';
import {shellT} from '../i18n/t';
import {agentStatusLabel, roleLabel, teamKindLabel, teamListTitle, teamStatusLabel} from '../teamsDisplay';
import {WorkflowReadonly} from '../WorkflowReadonly';
import {agentPrompt, projectChip, type AgentRow, type TeamRow} from './rows';

export function TeamDetail(p: Record<string, any>) {
	const {
		selectedTeam, agents, goalNameById, workflowSteps, actionBusy, expandedMemberId, setExpandedMemberId,
		onPromoteTeam, onArchiveTeam, onSaveAsTeam, onDeleteTeam, onInsertMention, openWorkflowAgent,
		startCreate
	} = p;
	return (
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{teamListTitle(selectedTeam, goalNameById)}
									</h2>
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										{teamKindLabel(selectedTeam.kind)} ·{' '}
										{teamStatusLabel(selectedTeam.status)}
									</span>
								</div>
								{selectedTeam.description ? (
									<p className="text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
										{selectedTeam.description}
									</p>
								) : null}
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedTeam.projectId, selectedTeam.projectDisplayName)}
									{selectedTeam.kind === 'ephemeral' && selectedTeam.originGoalId
										? shellT('shell.teams.fromGoal')
										: null}
								</p>
							</header>

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.members')}</h3>
									<span className="text-[11px] text-muted-foreground">
										{shellT('shell.teams.membersHint', {count: (selectedTeam.members ?? []).length})}
									</span>
								</div>
								<ul className="overflow-hidden rounded-xl border border-border">
									{(selectedTeam.members ?? []).length === 0 ? (
										<li className="px-3 py-4 text-sm text-muted-foreground">{shellT('shell.teams.noMembers')}</li>
									) : null}
									{(selectedTeam.members ?? []).map((m: NonNullable<TeamRow['members']>[number], mi: number) => {
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
													{prompt.model || agent?.model ? (
														<span className="truncate text-[11px] text-muted-foreground">
															{prompt.model || agent?.model}
														</span>
													) : null}
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
																<p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
																	{agent.taskBrief}
																</p>
															</div>
														) : null}
														<div>
															<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																{shellT('shell.teams.systemPrompt')}
															</div>
															{prompt.systemPrompt ? (
																<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
																	{prompt.systemPrompt}
																</pre>
															) : (
																<p className="text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
															)}
														</div>
														<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
															{prompt.model || agent?.model ? (
																<span>
																	{shellT('shell.teams.modelLine', {
																		model: prompt.model || agent?.model || ''
																	})}
																</span>
															) : null}
															{prompt.maxTurns != null ? (
																<span>{shellT('shell.teams.maxTurnsLine', {count: prompt.maxTurns})}</span>
															) : null}
															<span>{shellT('shell.teams.statusLine', {status: agentStatusLabel(agent?.status ?? 'idle')})}</span>
														</div>
													</div>
												) : null}
											</li>
										);
									})}
								</ul>
							</section>

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">Workflow</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.defaultTemplate')}</span>
								</div>
								<WorkflowReadonly
									steps={workflowSteps}
									mode="template"
									goalLabel={teamListTitle(selectedTeam, goalNameById)}
									resultLabel={shellT('shell.teams.resultLabel')}
									onOpenStep={use => openWorkflowAgent(use, selectedTeam.id)}
								/>
							</section>

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onInsertMention(
												'team',
												selectedTeam.name,
												teamListTitle(selectedTeam, goalNameById),
												selectedTeam.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{selectedTeam.kind === 'ephemeral' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onPromoteTeam(selectedTeam)}
									>
										{shellT('shell.teams.promoteTeam')}
									</Button>
								) : null}
								{selectedTeam.kind === 'explicit' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onArchiveTeam(selectedTeam)}
									>
										{selectedTeam.status === 'archived' ? shellT('shell.teams.restore') : shellT('shell.teams.archive')}
									</Button>
								) : null}
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void onSaveAsTeam(selectedTeam)}
								>
									{shellT('shell.teams.saveAs')}
								</Button>
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void startCreate('agent')}
								>
									{shellT('shell.teams.addMember')}
								</Button>
								{selectedTeam.status !== 'deleted' ? (
									<Button
										type="button"
										size="xs"
										variant="outline"
										className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
										disabled={actionBusy}
										onClick={() => void onDeleteTeam(selectedTeam)}
									>
										{shellT('shell.teams.delete')}
									</Button>
								) : null}
							</footer>
						</div>
	);
}
