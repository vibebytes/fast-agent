import {useEffect, useSyncExternalStore} from 'react';
import type {CreateSkillInput, MarketSkillRow, SkillRow} from '@fast-ide/session-view';

export type SkillsStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type Skill = SkillRow;
export type MarketSkill = MarketSkillRow;
export type CreateInput = CreateSkillInput;

export type SkillsView = {
	status: SkillsStatus;
	skills: Skill[];
	notice: string | null;
	engineReady: boolean;
};

type SkillsApi = {
	listSkills: () => Promise<{ok: true; skills: Skill[]} | {ok: false; notice: string}>;
	createSkill: (
		input: CreateInput
	) => Promise<{ok: true; skill: Skill} | {ok: false; notice: string}>;
	deleteSkill: (name: string, scope: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	setSkillEnabled: (
		name: string,
		scope: string,
		enabled: boolean
	) => Promise<{ok: true; skill: Skill} | {ok: false; notice: string}>;
	searchSkillMarket: (
		query: string
	) => Promise<
		{ok: true; marketSkills: MarketSkill[]; message?: string} | {ok: false; notice: string}
	>;
	installSkillFromMarket: (
		source: string,
		scope: string
	) => Promise<{ok: true} | {ok: false; notice: string}>;
	uninstallSkillFromMarket: (
		name: string,
		scope: string
	) => Promise<{ok: true} | {ok: false; notice: string}>;
	onSkillsChanged?: (handler: (payload: {skillName: string}) => void) => () => void;
};

function viewOf(
	skills: Skill[],
	status: SkillsStatus,
	notice: string | null,
	engineReady: boolean
): SkillsView {
	return {status, skills, notice, engineReady};
}

function liveApi(): SkillsApi {
	return {
		listSkills: () => window.fastIde.listSkills(),
		createSkill: input => window.fastIde.createSkill(input),
		deleteSkill: (name, scope) => window.fastIde.deleteSkill(name, scope),
		setSkillEnabled: (name, scope, enabled) =>
			window.fastIde.setSkillEnabled(name, scope, enabled),
		searchSkillMarket: query => window.fastIde.searchSkillMarket(query),
		installSkillFromMarket: (source, scope) =>
			window.fastIde.installSkillFromMarket(source, scope),
		uninstallSkillFromMarket: (name, scope) =>
			window.fastIde.uninstallSkillFromMarket(name, scope),
		onSkillsChanged: handler => window.fastIde.onSkillsChanged(handler)
	};
}

function skillKey(skill: {name: string; scope: string}): string {
	return `${skill.scope}:${skill.name}`;
}

function upsertLocal(list: Skill[], skill: Skill): Skill[] {
	const key = skillKey(skill);
	const idx = list.findIndex(s => skillKey(s) === key);
	if (idx < 0) return [...list, skill];
	const next = [...list];
	next[idx] = skill;
	return next;
}

function removeLocal(list: Skill[], name: string, scope: string): Skill[] {
	const key = `${scope}:${name}`;
	return list.filter(s => skillKey(s) !== key);
}

class SkillsStore {
	private view: SkillsView = viewOf([], 'loading', null, false);
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private generation = 0;
	private api: SkillsApi = liveApi();

	/** Test seam — swap IPC for an in-memory double. */
	bindApi(api: SkillsApi): void {
		this.api = api;
	}

	/** Test seam — clear cached view between cases. */
	resetForTest(): void {
		this.generation += 1;
		this.inflight = null;
		this.view = viewOf([], 'loading', null, false);
		this.publish();
	}

	getSnapshot = (): SkillsView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: SkillsView): void {
		this.view = next;
		this.publish();
	}

	setEngineReady(ready: boolean): void {
		if (this.view.engineReady === ready) return;
		if (!ready) {
			this.setView({...this.view, engineReady: false, status: 'disabled', notice: null});
			return;
		}
		this.setView({...this.view, engineReady: true});
		void this.list();
	}

	list = async (): Promise<void> => {
		if (!this.view.engineReady) {
			this.setView({...this.view, status: 'disabled', notice: null});
			return;
		}
		const gen = ++this.generation;
		this.setView({...this.view, status: 'loading', notice: null});
		const run = this.api.listSkills().then(res => {
			if (gen !== this.generation) return;
			if (!res.ok) {
				this.setView(viewOf(this.view.skills, 'error', res.notice, true));
				return;
			}
			this.setView(viewOf(res.skills, 'ready', null, true));
		});
		this.inflight = run.finally(() => {
			if (this.inflight === run) this.inflight = null;
		});
		await this.inflight;
	};

	retry = (): void => {
		void this.list();
	};

	invalidate = (): void => {
		if (!this.view.engineReady) return;
		void this.list();
	};

	create = async (input: CreateInput): Promise<Skill | null> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return null;
		const prev = this.view;
		const res = await this.api.createSkill(input);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return null;
		}
		this.setView(viewOf(upsertLocal(this.view.skills, res.skill), 'ready', null, true));
		return res.skill;
	};

	remove = async (name: string, scope: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		this.setView(viewOf(removeLocal(prev.skills, name, scope), 'ready', null, true));
		const res = await this.api.deleteSkill(name, scope);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		return true;
	};

	setEnabled = async (name: string, scope: string, enabled: boolean): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const key = `${scope}:${name}`;
		const optimistic = prev.skills.map(s =>
			skillKey(s) === key ? {...s, enabled} : s
		);
		this.setView(viewOf(optimistic, 'ready', null, true));
		const res = await this.api.setSkillEnabled(name, scope, enabled);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView(viewOf(upsertLocal(this.view.skills, res.skill), 'ready', null, true));
		return true;
	};

	searchMarket = async (
		query: string
	): Promise<{marketSkills: MarketSkill[]; message?: string} | null> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return null;
		const res = await this.api.searchSkillMarket(query);
		if (!res.ok) {
			this.setView({...this.view, notice: res.notice, status: 'ready'});
			return null;
		}
		return {
			marketSkills: res.marketSkills,
			...(res.message !== undefined ? {message: res.message} : {})
		};
	};

	installMarket = async (source: string, scope: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const res = await this.api.installSkillFromMarket(source, scope);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		void this.list();
		return true;
	};

	uninstallMarket = async (name: string, scope: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		this.setView(viewOf(removeLocal(prev.skills, name, scope), 'ready', null, true));
		const res = await this.api.uninstallSkillFromMarket(name, scope);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		return true;
	};
}

export const skillsStore = new SkillsStore();

let pushBound = false;

function ensurePush(): void {
	if (pushBound) return;
	pushBound = true;
	const api = liveApi();
	api.onSkillsChanged?.(() => {
		skillsStore.invalidate();
	});
}

/** Settings-center skills (disk + market) — Plugins P1. */
export function useSkills(engineReady: boolean): SkillsView & {
	retry: () => void;
	list: () => Promise<void>;
	create: (input: CreateInput) => Promise<Skill | null>;
	remove: (name: string, scope: string) => Promise<boolean>;
	setEnabled: (name: string, scope: string, enabled: boolean) => Promise<boolean>;
	searchMarket: (
		query: string
	) => Promise<{marketSkills: MarketSkill[]; message?: string} | null>;
	installMarket: (source: string, scope: string) => Promise<boolean>;
	uninstallMarket: (name: string, scope: string) => Promise<boolean>;
} {
	useEffect(() => {
		ensurePush();
		skillsStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(
		skillsStore.subscribe,
		skillsStore.getSnapshot,
		skillsStore.getSnapshot
	);

	return {
		...view,
		retry: skillsStore.retry,
		list: skillsStore.list,
		create: skillsStore.create,
		remove: skillsStore.remove,
		setEnabled: skillsStore.setEnabled,
		searchMarket: skillsStore.searchMarket,
		installMarket: skillsStore.installMarket,
		uninstallMarket: skillsStore.uninstallMarket
	};
}
