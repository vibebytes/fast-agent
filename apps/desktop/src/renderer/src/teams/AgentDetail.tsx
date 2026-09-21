import {Button} from '@fast-ide/ui/components/button';
import {shellT} from '../i18n/t';
import {agentListTitle, agentStatusLabel, roleLabel, teamListTitle} from '../teamsDisplay';
import {agentPrompt, projectChip, type TeamRow} from './rows';

export function AgentDetail(p: Record<string, any>) {
	const {
		selectedAgent, teams, teamNameById, goalNameById, agentNameDup, actionBusy, cloneTeamId, setCloneTeamId,
		selectedTeamId, setSelectedTeamId, setTab, onCloneAgent, onStopAgentRun, onArchiveAgent,
		onDeleteAgent, onInsertMention
	} = p;
	return (
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{agentListTitle(
											selectedAgent.name,
											selectedAgent.id,
											agentNameDup.has(selectedAgent.name.trim().toLowerCase())
										)}
									</h2>
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										{agentStatusLabel(selectedAgent.status)}
									</span>
									{selectedAgent.teamRole ? (
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
											{roleLabel(selectedAgent.teamRole)}
										</span>
									) : null}
								</div>
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedAgent.projectId, selectedAgent.projectDisplayName)}
									{selectedAgent.teamId ? (
										<>
											{' · '}
											<button
												type="button"
												className="underline-offset-2 hover:underline"
												onClick={() => {
													setSelectedTeamId(selectedAgent.teamId!);
													setTab('teams');
												}}
											>
												{shellT('shell.teams.teamLink', {name: teamNameById.get(selectedAgent.teamId) ?? shellT('shell.teams.view')})}
											</button>
										</>
									) : (
										shellT('shell.teams.notInTeam')
									)}
								</p>
							</header>

							{(() => {
								const prompt = agentPrompt(selectedAgent);
								const model = prompt.model || selectedAgent.model;
								return (
									<section className="space-y-2">
										<div className="flex items-baseline justify-between gap-2">
											<h3 className="text-[13px] font-semibold">{shellT('shell.teams.config')}</h3>
											<span className="text-[11px] text-muted-foreground">
												{shellT('shell.teams.readonlyDecl')}
											</span>
										</div>
										<div className="overflow-hidden rounded-xl border border-border">
											<dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.model')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium">
														{model || shellT('shell.teams.default')}
													</dd>
												</div>
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.role')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium">
														{selectedAgent.teamRole
															? roleLabel(selectedAgent.teamRole)
															: shellT('shell.teams.unspecified')}
													</dd>
												</div>
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.maxTurns')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium tabular-nums">
														{prompt.maxTurns != null ? prompt.maxTurns : '—'}
													</dd>
												</div>
											</dl>
											{selectedAgent.taskBrief ? (
												<div className="border-t border-border px-3 py-2.5">
													<div className="mb-1 text-[10px] font-medium text-muted-foreground">
														{shellT('shell.teams.taskBrief')}
													</div>
													<p className="whitespace-pre-wrap text-[12px] leading-relaxed">
														{selectedAgent.taskBrief}
													</p>
												</div>
											) : null}
											<div className="border-t border-border px-3 py-2.5">
												<div className="mb-1 text-[10px] font-medium text-muted-foreground">
													{shellT('shell.teams.systemPrompt')}
												</div>
												{prompt.systemPrompt ? (
													<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
														{prompt.systemPrompt}
													</pre>
												) : (
													<p className="text-[12px] text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
												)}
											</div>
										</div>
									</section>
								);
							})()}

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.cloneToTeam')}</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.cloneHint')}</span>
								</div>
								<div className="flex flex-wrap items-end gap-2 rounded-xl border border-border px-3 py-2.5 text-xs">
									<label className="flex min-w-[160px] flex-1 flex-col gap-0.5">
										<span className="text-muted-foreground">{shellT('shell.teams.targetTeam')}</span>
										<select
											className="h-8 rounded border bg-background px-2"
											value={cloneTeamId || selectedTeamId || ''}
											onChange={e => setCloneTeamId(e.target.value)}
										>
											<option value="">{shellT('shell.teams.selectTeam')}</option>
											{teams
												.filter((t: TeamRow) => t.status === 'active' && t.kind !== 'deleted')
												.map((t: TeamRow) => (
													<option key={t.id} value={t.id}>
														{teamListTitle(t, goalNameById)}
													</option>
												))}
										</select>
									</label>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={actionBusy || !(cloneTeamId || selectedTeamId)}
										onClick={() => void onCloneAgent(selectedAgent)}
									>
										{shellT('shell.teams.cloneJoin')}
									</Button>
								</div>
							</section>

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onInsertMention(
												'agent',
												selectedAgent.name,
												selectedAgent.name,
												selectedAgent.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{selectedAgent.status === 'running' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onStopAgentRun(selectedAgent)}
									>
										{shellT('shell.teams.stopCurrent')}
									</Button>
								) : null}
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void onArchiveAgent(selectedAgent)}
								>
									{selectedAgent.status === 'archived' ||
									selectedAgent.status === 'disabled'
										? shellT('shell.teams.restore')
										: shellT('shell.teams.archive')}
								</Button>
								<Button
									type="button"
									size="xs"
									variant="outline"
									className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
									disabled={actionBusy}
									onClick={() => void onDeleteAgent(selectedAgent)}
								>
									{shellT('shell.teams.delete')}
								</Button>
							</footer>
						</div>
	);
}
