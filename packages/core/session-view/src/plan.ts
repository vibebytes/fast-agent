/** Session Plan payload (message_type=plan). plan_id = message id. */

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed';

export type PlanTodoView = {
	id: string;
	content: string;
	status: PlanTodoStatus;
};

export type PlanView = {
	planId: string;
	name: string;
	overview: string;
	todos: PlanTodoView[];
	body: string;
};

/** @deprecated Prefer PlanBuild Submit (`planBuild` payload); kept for tests/compat. */
export function planBuildSubmitText(planId: string): string {
	return `Execute the plan with plan_id=${planId}. Follow its todos and call upsert_plan update as you complete steps.`;
}

/** UI display content for PlanBuild user row (`执行计划：{name}`). */
export function planBuildDisplayContent(name: string, planId: string): string {
	const n = name.trim();
	if (n) return `执行计划：${n}`;
	const id = planId.trim();
	return `执行计划：${id.length > 8 ? id.slice(0, 8) : id}`;
}

export function planTodoProgress(todos: PlanTodoView[]): {completed: number; total: number; current?: PlanTodoView} {
	const total = todos.length;
	const completed = todos.filter(t => t.status === 'completed').length;
	const current =
		todos.find(t => t.status === 'in_progress') ?? todos.find(t => t.status === 'pending');
	return {completed, total, current};
}

export function normalizeTodoStatus(raw: string | undefined | null): PlanTodoStatus {
	const s = (raw ?? '').trim().toLowerCase();
	if (s === 'in_progress' || s === 'completed' || s === 'pending') return s;
	return 'pending';
}

export function normalizeTodos(
	todos: Array<{id?: string; content?: string; status?: string} | null | undefined> | null | undefined
): PlanTodoView[] {
	if (!todos?.length) return [];
	return todos
		.filter((t): t is {id?: string; content?: string; status?: string} => Boolean(t?.id?.trim()))
		.map(t => ({
			id: t.id!.trim(),
			content: (t.content ?? '').trim(),
			status: normalizeTodoStatus(t.status)
		}));
}

/** Parse plan payload_json; returns null when unusable. */
export function parsePlanPayloadJson(raw: string | null | undefined): Omit<PlanView, 'planId'> | null {
	const text = raw?.trim();
	if (!text) return null;
	try {
		const j = JSON.parse(text) as {
			name?: unknown;
			overview?: unknown;
			todos?: unknown;
			body?: unknown;
		};
		if (j == null || typeof j !== 'object') return null;
		const todosRaw = Array.isArray(j.todos) ? j.todos : [];
		return {
			name: typeof j.name === 'string' ? j.name : '',
			overview: typeof j.overview === 'string' ? j.overview : '',
			todos: normalizeTodos(
				todosRaw as Array<{id?: string; content?: string; status?: string}>
			),
			body: typeof j.body === 'string' ? j.body : ''
		};
	} catch {
		return null;
	}
}

type PlanWire = {
	planId?: string | null;
	messageId?: string | null;
	name?: string | null;
	overview?: string | null;
	todos?: Array<{id?: string; content?: string; status?: string}> | null;
	body?: string | null;
	payloadJson?: string | null;
};

/** Resolve PlanView from bridge wire (structured fields and/or payloadJson). */
export function planFromWire(wire: PlanWire, fallbackPlanId?: string): PlanView | null {
	const planId = (wire.planId ?? wire.messageId ?? fallbackPlanId ?? '').trim();
	if (!planId) return null;
	const fromJson = parsePlanPayloadJson(wire.payloadJson ?? undefined);
	return {
		planId,
		name: (wire.name ?? fromJson?.name ?? '').trim() || (fromJson?.name ?? ''),
		overview: (wire.overview ?? fromJson?.overview ?? '').trim() || (fromJson?.overview ?? ''),
		todos: wire.todos != null ? normalizeTodos(wire.todos) : (fromJson?.todos ?? []),
		body: wire.body ?? fromJson?.body ?? ''
	};
}

/** Merge patch onto an existing plan (update may send only todos). */
export function mergePlanPatch(prev: PlanView, patch: PlanView, action: string): PlanView {
	const a = action.trim().toLowerCase();
	if (a === 'update') {
		return {
			...prev,
			planId: patch.planId || prev.planId,
			name: patch.name || prev.name,
			overview: patch.overview || prev.overview,
			body: patch.body || prev.body,
			todos: patch.todos.length > 0 ? mergeTodos(prev.todos, patch.todos) : prev.todos
		};
	}
	// create / replace / unknown → full snapshot when present
	return {
		planId: patch.planId || prev.planId,
		name: patch.name || prev.name,
		overview: patch.overview || prev.overview,
		todos: patch.todos.length > 0 || a === 'replace' ? patch.todos : prev.todos,
		body: patch.body || prev.body
	};
}

function mergeTodos(prev: PlanTodoView[], patch: PlanTodoView[]): PlanTodoView[] {
	if (patch.length === 0) return prev;
	const byId = new Map(prev.map(t => [t.id, t]));
	for (const t of patch) {
		const old = byId.get(t.id);
		byId.set(t.id, {
			id: t.id,
			content: t.content || old?.content || '',
			status: t.status
		});
	}
	// Preserve prev order; append unknown ids from patch.
	const seen = new Set<string>();
	const out: PlanTodoView[] = [];
	for (const t of prev) {
		const next = byId.get(t.id);
		if (next) {
			out.push(next);
			seen.add(t.id);
		}
	}
	for (const t of patch) {
		if (!seen.has(t.id)) out.push(byId.get(t.id)!);
	}
	return out;
}
