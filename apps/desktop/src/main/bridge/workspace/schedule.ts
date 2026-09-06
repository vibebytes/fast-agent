import {hostRequest, type HostLane} from './hostWait.js';

type Notice = {ok: false; notice: string};

type JobRow = {
	id: string;
	kind: string;
	status: string;
	sessionId: string;
	projectId?: string | null;
	projectDisplayName?: string | null;
	cronExpr?: string | null;
	timezone?: string | null;
	nextFireAt?: string | null;
	title?: string | null;
	promptText?: string | null;
	targetKind?: string | null;
	targetRef?: string | null;
};

export type ScheduleLane = HostLane & {
	livingLabel: (metaId: string, fromMeta?: string) => string | undefined;
};

export type WorkspaceSchedule = {
	listScheduledJobs: (projectId?: string | null) => Promise<{ok: true; jobs: JobRow[]} | Notice>;
	listLivingTasks: () => Promise<
		{ok: true; projects: Array<{projectId: string; displayName?: string; sessions?: unknown[]}>} | Notice
	>;
	createScheduledJob: (input: {
		kind: string;
		cronExpr: string;
		timezone?: string;
		recurring?: boolean;
		targetKind: string;
		targetRef?: string;
		promptText?: string;
		targetArgsJson?: string;
		maxFires?: number;
		title?: string;
		fireImmediately?: boolean;
		sessionId?: string;
		projectId?: string;
	}) => Promise<{ok: true; job: JobRow} | Notice>;
	pauseScheduledJob: (id: string) => Promise<{ok: true} | Notice>;
	resumeScheduledJob: (id: string) => Promise<{ok: true} | Notice>;
	cancelScheduledJob: (id: string) => Promise<{ok: true} | Notice>;
	fireNowScheduledJob: (id: string) => Promise<{ok: true} | Notice>;
	updateScheduledJobCron: (id: string, cronExpr: string, timezone?: string) => Promise<{ok: true} | Notice>;
	listScheduledJobRuns: (id: string) => Promise<
		{
			ok: true;
			runs: Array<{
				id: string;
				jobId: string;
				sessionId: string;
				status: string;
				startedAt?: string | null;
				finishedAt?: string | null;
				summary?: string | null;
				error?: string | null;
				runId?: string | null;
			}>;
		} | Notice
	>;
};

export function createSchedule(lane: ScheduleLane): WorkspaceSchedule {
	const decorate = (row: JobRow): JobRow => {
		const meta = row.projectId?.trim();
		const projectDisplayName = (meta ? lane.displayName(meta) : undefined) || row.projectDisplayName || undefined;
		return {...row, ...(projectDisplayName ? {projectDisplayName} : {})};
	};

	const jobOp = async (
		type: 'PauseScheduledJob' | 'ResumeScheduledJob' | 'CancelScheduledJob' | 'FireNowScheduledJob',
		id: string
	): Promise<{ok: true} | Notice> => {
		const r = await hostRequest(lane, [type], {type, id});
		if (!r.ok) return r;
		if (r.event.status === 'error') return {ok: false, notice: r.event.message};
		return {ok: true};
	};

	return {
		async listScheduledJobs(projectId) {
			const metaId = projectId ? lane.metaId(projectId) : undefined;
			if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			const r = await hostRequest(
				lane,
				['ListScheduledJobs'],
				{type: 'ListScheduledJobs', ...(metaId ? {projectId: metaId} : {})},
				{metaId}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const jobs = Array.isArray(r.event.scheduledJobs) ? r.event.scheduledJobs : [];
			return {ok: true, jobs: jobs.map(j => decorate(j as JobRow))};
		},
		async listLivingTasks() {
			const r = await hostRequest(lane, ['ListLivingTasks'], {type: 'ListLivingTasks'}, {timeoutMs: 45_000});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const raw = Array.isArray(r.event.livingTasks) ? r.event.livingTasks : [];
			return {
				ok: true,
				projects: raw.map(p => {
					const o = p as {projectId?: string; displayName?: string; sessions?: unknown[]};
					const projectId = String(o.projectId ?? '');
					const fromMeta = o.displayName != null ? String(o.displayName).trim() : '';
					const displayName = projectId ? lane.livingLabel(projectId, fromMeta) : fromMeta || undefined;
					return {
						projectId,
						...(displayName ? {displayName} : {}),
						...(Array.isArray(o.sessions) ? {sessions: o.sessions} : {})
					};
				})
			};
		},
		async createScheduledJob(input) {
			const kind = input.kind.trim();
			const cronExpr = input.cronExpr.trim();
			const targetKind = input.targetKind.trim();
			if (!kind) return {ok: false, notice: 'kind required'};
			if (!cronExpr) return {ok: false, notice: 'cronExpr required'};
			if (!targetKind) return {ok: false, notice: 'targetKind required'};
			const folderProjectId = input.projectId?.trim();
			const metaId = folderProjectId ? lane.metaId(folderProjectId) : undefined;
			if (folderProjectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			const r = await hostRequest(
				lane,
				['CreateScheduledJob'],
				{
					type: 'CreateScheduledJob',
					kind,
					cronExpr,
					targetKind,
					...(input.timezone?.trim() ? {timezone: input.timezone.trim()} : {}),
					...(input.recurring !== undefined ? {recurring: input.recurring} : {}),
					...(input.targetRef?.trim() ? {targetRef: input.targetRef.trim()} : {}),
					...(input.promptText?.trim() ? {promptText: input.promptText.trim()} : {}),
					...(input.targetArgsJson?.trim() ? {targetArgsJson: input.targetArgsJson.trim()} : {}),
					...(input.maxFires !== undefined ? {maxFires: input.maxFires} : {}),
					...(input.title?.trim() ? {title: input.title.trim()} : {}),
					...(input.fireImmediately !== undefined ? {fireImmediately: input.fireImmediately} : {}),
					...(input.sessionId?.trim() ? {sessionId: input.sessionId.trim()} : {}),
					...(metaId ? {projectId: metaId} : {})
				},
				{metaId}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const jobs = Array.isArray(r.event.scheduledJobs) ? r.event.scheduledJobs : [];
			const raw = jobs[0] as JobRow | undefined;
			if (!raw?.id) return {ok: false, notice: 'No job in CreateScheduledJob result'};
			return {ok: true, job: decorate(raw)};
		},
		pauseScheduledJob: id => jobOp('PauseScheduledJob', id),
		resumeScheduledJob: id => jobOp('ResumeScheduledJob', id),
		cancelScheduledJob: id => jobOp('CancelScheduledJob', id),
		fireNowScheduledJob: id => jobOp('FireNowScheduledJob', id),
		async updateScheduledJobCron(id, cronExpr, timezone) {
			const trimmed = cronExpr.trim();
			if (!trimmed) return {ok: false, notice: 'cronExpr required'};
			const r = await hostRequest(lane, ['UpdateScheduledJobCron'], {
				type: 'UpdateScheduledJobCron',
				id,
				cronExpr: trimmed,
				...(timezone?.trim() ? {timezone: timezone.trim()} : {})
			});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true};
		},
		async listScheduledJobRuns(id) {
			const r = await hostRequest(lane, ['ListScheduledJobRuns'], {type: 'ListScheduledJobRuns', id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const runs = Array.isArray(r.event.scheduledJobRuns) ? r.event.scheduledJobRuns : [];
			return {ok: true, runs};
		}
	};
}
