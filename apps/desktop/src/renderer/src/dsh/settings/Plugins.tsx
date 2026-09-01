import {useEffect, useMemo, useState} from 'react';
import {SettingsButton, SettingsRow, SettingsSection, SettingsState, settingsControlClass} from '../../settings/SettingsPrimitives';
import {failText, pluginsCopy as t} from './copy';
import {PageNotice} from './Fields';
import {
	asInventory,
	fiberLabel,
	fieldStored,
	fieldView,
	formatField,
	inventoryMatches,
	keyRef,
	moduleShortName,
	planField,
	pluginCards,
	pluginNs,
	sectionValue,
	type InventoryEntry,
	type PluginCardSpec,
	type Staged
} from './pluginCards';
import {dshMutate, type SettingsDescribe, type SettingsNs} from './settings';

type Tab = 'config' | 'list';

export function Plugins({
	describe,
	onReload,
	writable
}: {
	describe: SettingsDescribe | null;
	onReload: () => void;
	writable: boolean;
}) {
	const [tab, setTab] = useState<Tab>('config');
	const cards = pluginCards.filter(card => pluginNs(describe, card.aliases));

	return (
		<div className="space-y-4">
			<div className="flex gap-4 border-b border-border/40">
				{(
					[
						['config', t.configTab],
						['list', t.listTab]
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						type="button"
						className={`border-b-2 px-0 py-2 text-[13px] ${
							tab === id
								? 'border-foreground font-medium text-foreground'
								: 'border-transparent text-muted-foreground'
						}`}
						onClick={() => setTab(id)}
					>
						{label}
					</button>
				))}
			</div>
			{tab === 'config' ? (
				cards.length === 0 ? (
					<SettingsState status="empty" title={t.empty} />
				) : (
					<div className="space-y-3">
						{cards.map(card => (
							<ConfigCard
								key={card.id}
								card={card}
								view={pluginNs(describe, card.aliases)!}
								writable={writable}
								onReload={onReload}
							/>
						))}
					</div>
				)
			) : (
				<Inventory />
			)}
		</div>
	);
}

function ConfigCard({
	card,
	view,
	writable,
	onReload
}: {
	card: PluginCardSpec;
	view: SettingsNs;
	writable: boolean;
	onReload: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [drafts, setDrafts] = useState<Record<string, Staged>>({});
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [keyState, setKeyState] = useState<{configured?: boolean; writable?: boolean}>();
	const ref = keyRef(view);
	const secret = card.fields.some(f => f.kind === 'secret');

	useEffect(() => {
		setDrafts({});
		setFailed(false);
		setNotice(null);
	}, [view.revision]);

	useEffect(() => {
		if (!secret) return;
		void window.fastIde.dshSettings.credentialsDescribe([ref]).then(result => {
			if (!result.ok || !result.value || typeof result.value !== 'object') return;
			const map = (result.value as {credentials?: Record<string, {configured?: boolean; writable?: boolean}>})
				.credentials;
			if (map) setKeyState(map[ref]);
		});
	}, [ref, secret, view.revision]);

	const plan = card.fields.flatMap(field => {
		const next = planField(field, drafts[field.key], sectionValue(view, field.key), fieldStored(view, field.key));
		return next ? [next] : [];
	});
	const dirty = plan.length > 0;
	const invalid = plan.some(item => item.op === 'invalid');

	function edit(key: string, text: string) {
		setFailed(false);
		setDrafts(cur => ({...cur, [key]: {text, clear: false}}));
	}

	function resetField(key: string, text: string) {
		setFailed(false);
		setDrafts(cur => ({...cur, [key]: {text, clear: true}}));
	}

	function discard() {
		setDrafts({});
		setFailed(false);
		setNotice(null);
	}

	async function save() {
		if (!dirty || invalid || busy) return;
		setBusy(true);
		setNotice(null);
		setFailed(false);
		const ops: Array<{op: 'set'; path: string[]; value: unknown} | {op: 'unset'; path: string[]}> = [];
		for (const item of plan) {
			if (item.op === 'set') ops.push({op: 'set', path: [item.key], value: item.value});
			else if (item.op === 'unset') ops.push({op: 'unset', path: [item.key]});
		}
		if (ops.length > 0) {
			const mutated = await dshMutate(view.ns, ops, view.revision);
			if (!mutated.ok) {
				setNotice(mutated.error.code === 'settings-conflict' ? t.conflict : failText(mutated.error));
				setFailed(true);
				setBusy(false);
				return;
			}
		}
		const secretWrite = plan.find(item => item.op === 'secret');
		if (secretWrite && secretWrite.op === 'secret') {
			const set = await window.fastIde.dshSettings.credentialsSet(ref, secretWrite.value);
			if (!set.ok) {
				setNotice(failText(set.error));
				setFailed(true);
				setBusy(false);
				return;
			}
		}
		setDrafts({});
		setBusy(false);
		onReload();
	}

	return (
		<SettingsSection>
			<button
				type="button"
				className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
				aria-expanded={open}
				onClick={() => setOpen(v => !v)}
			>
				<span className="min-w-0">
					<span className="block text-[13px] font-semibold text-foreground">{card.title}</span>
					<span className="block text-[12px] text-muted-foreground">{card.description}</span>
				</span>
				<span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
					{dirty ? <span className="text-amber-600">{t.unsaved}</span> : null}
					<span>{open ? '▾' : '▸'}</span>
				</span>
			</button>
			{open ? (
				<>
					{!writable ? <p className="px-4 py-2 text-[12px] text-muted-foreground">{t.readOnly}</p> : null}
					{card.fields.map(field => {
						const shown = fieldView(
							field,
							drafts[field.key],
							sectionValue(view, field.key),
							fieldStored(view, field.key)
						);
						const locked = field.kind === 'secret' ? keyState?.writable === false : !writable;
						return (
							<SettingsRow
								key={field.key}
								title={field.title}
								description={shown.invalid ? t.invalidNumber : field.hint}
								badge={
									field.kind === 'secret' ? (
										<span className="text-[11px] text-muted-foreground">
											{keyState?.configured ? t.keySet : t.keyUnset}
										</span>
									) : shown.overridden ? (
										<span className="flex items-center gap-1">
											<span className="text-[11px] text-muted-foreground">{t.overridden}</span>
											<SettingsButton
												variant="ghost"
												disabled={locked || busy}
												onClick={() =>
													resetField(
														field.key,
														formatField(
															field.kind,
															view.base && typeof view.base === 'object'
																? (view.base as Record<string, unknown>)[field.key]
																: undefined
														)
													)
												}
											>
												{t.reset}
											</SettingsButton>
										</span>
									) : undefined
								}
							>
								<input
									className={`${settingsControlClass} min-w-36 ${shown.invalid ? 'border-destructive' : ''}`}
									type={field.kind === 'secret' ? 'password' : 'text'}
									inputMode={field.kind === 'number' ? 'numeric' : undefined}
									autoComplete="off"
									value={shown.text}
									disabled={locked || busy}
									placeholder={field.kind === 'secret' && keyState?.configured ? t.keyStored : undefined}
									onChange={e => edit(field.key, e.target.value)}
								/>
							</SettingsRow>
						);
					})}
					<PageNotice text={notice} />
					{failed && !notice ? <p className="px-4 py-2 text-[12px] text-destructive">{t.saveFailed}</p> : null}
					<div className="flex justify-end gap-1.5 px-4 py-3">
						<SettingsButton variant="outline" disabled={!dirty || busy} onClick={discard}>
							{t.discard}
						</SettingsButton>
						<SettingsButton disabled={!writable || !dirty || invalid || busy} onClick={() => void save()}>
							{busy ? t.saving : t.save}
						</SettingsButton>
					</div>
				</>
			) : null}
		</SettingsSection>
	);
}

function Inventory() {
	const [query, setQuery] = useState('');
	const [entries, setEntries] = useState<InventoryEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);

	async function load() {
		setError(null);
		const result = await window.fastIde.dshSettings.pluginInventoryList();
		if (!result.ok) {
			setEntries(null);
			setError(failText(result.error));
			return;
		}
		setEntries(asInventory(result.value));
	}

	useEffect(() => {
		void load();
	}, []);

	const shown = useMemo(
		() => (entries ?? []).filter(entry => inventoryMatches(entry, query)),
		[entries, query]
	);

	if (error && !entries) {
		return <SettingsState status="error" title={t.listError} description={error} onRetry={() => void load()} />;
	}
	if (!entries) {
		return <SettingsState status="loading" title={t.listLoading} />;
	}

	return (
		<div className="space-y-3">
			<input
				className={`${settingsControlClass} w-full min-w-0`}
				type="search"
				placeholder={t.search}
				value={query}
				onChange={e => setQuery(e.target.value)}
			/>
			<p className="text-[12px] text-muted-foreground">
				{t.catalog} {shown.length}
			</p>
			{entries.length === 0 ? (
				<p className="text-[12px] text-muted-foreground">{t.listEmpty}</p>
			) : shown.length === 0 ? (
				<p className="text-[12px] text-muted-foreground">{t.listEmptySearch}</p>
			) : (
				<ul className="grid grid-cols-2 gap-2">
					{shown.map(entry => {
						const open = expanded === entry.entryId;
						const title = moduleShortName(entry.moduleName);
						return (
							<li key={entry.entryId}>
								<SettingsSection>
									<button
										type="button"
										className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
										aria-expanded={open}
										onClick={() => setExpanded(cur => (cur === entry.entryId ? null : entry.entryId))}
									>
										<span className="min-w-0 truncate text-[12px] font-medium" title={entry.moduleName}>
											{title}
										</span>
										<span className="flex shrink-0 items-center gap-1.5 text-[11px]">
											{entry.enabled ? (
												<span className="flex items-center gap-1 text-emerald-600">
													<span className="size-1.5 rounded-full bg-emerald-500" />
													{t.enabled}
												</span>
											) : (
												<span className="text-muted-foreground">{t.disabled}</span>
											)}
											<span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
										</span>
									</button>
									{open ? (
										<div className="space-y-1 px-3 pb-3 text-[12px] text-muted-foreground">
											<code className="block truncate text-[11px]">{entry.entryId}</code>
											<p>
												{t.configuration} · {entry.enabled ? t.enabled : t.disabled}
											</p>
											{entry.enabled ? (
												<p>
													{t.cordis} · {fiberLabel(entry.fiberPhase)}
												</p>
											) : null}
										</div>
									) : null}
								</SettingsSection>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
