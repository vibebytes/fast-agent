import {useEffect, useState, type ReactNode} from 'react';
import {SettingsButton, SettingsSection, SettingsState, settingsControlClass} from '../../settings/SettingsPrimitives';
import {failText, presetDescription, presetName, presetsCopy as t} from './copy';
import {PageNotice} from './Fields';
import {
	asRoster,
	copyPayload,
	draftBlocker,
	groupPresets,
	type CopyDraft,
	type PresetRow
} from './presetJoin';
import {dshUpdateFresh, type SettingsDescribe} from './settings';

export function AgentPresets({
	describe,
	onReload,
	writable,
	sessionId
}: {
	describe: SettingsDescribe | null;
	onReload: () => void;
	writable: boolean;
	sessionId?: string;
}) {
	const [rows, setRows] = useState<PresetRow[]>([]);
	const [authorable, setAuthorable] = useState(false);
	const [hasDocument, setHasDocument] = useState(false);
	const [current, setCurrent] = useState<string | null>(null);
	const [blank, setBlank] = useState(true);
	const [notice, setNotice] = useState<string | null>(null);
	const [view, setView] = useState<{id: string; content: string} | null>(null);
	const [copy, setCopy] = useState<CopyDraft | null>(null);
	const [copyBusy, setCopyBusy] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<string | null>(null);
	const [revealed, setRevealed] = useState<Record<string, string>>({});
	const [loaded, setLoaded] = useState(false);

	async function loadRoster() {
		const list = await window.fastIde.dshSettings.agentPresetList();
		setLoaded(true);
		if (!list.ok) {
			setNotice(failText(list.error));
			return;
		}
		const roster = asRoster(list.value);
		setRows(roster.presets);
		setAuthorable(roster.authorable);
		setHasDocument(roster.hasDocument);
	}

	useEffect(() => {
		void loadRoster();
	}, [describe]);

	useEffect(() => {
		if (!sessionId) {
			setCurrent(null);
			setBlank(true);
			return;
		}
		void window.fastIde.dshSettings.sessionList().then(sessions => {
			if (!sessions.ok) {
				setNotice(failText(sessions.error));
				return;
			}
			if (!sessions.value || typeof sessions.value !== 'object') return;
			const items = (sessions.value as {items?: Array<{sessionId?: string; agentPreset?: string; blank?: boolean}>})
				.items;
			const hit = items?.find(s => s.sessionId === sessionId);
			setCurrent(hit?.agentPreset ?? null);
			setBlank(hit?.blank !== false);
		});
	}, [sessionId]);

	async function setDefault(id: string) {
		setNotice(null);
		const result = await dshUpdateFresh('agent-presets', {default: id});
		if (!result.ok) {
			setNotice(failText(result.error));
			onReload();
			return;
		}
		setRows(cur => cur.map(row => ({...row, isDefault: row.id === id})));
		onReload();
	}

	async function selectCurrent(id: string) {
		if (!sessionId) {
			setNotice(t.needSession);
			return;
		}
		const result = await window.fastIde.dshSettings.agentPresetSelect(sessionId, id);
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		setCurrent(id);
	}

	async function read(id: string) {
		const result = await window.fastIde.dshSettings.agentPresetRead(id);
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		const content =
			result.value && typeof result.value === 'object'
				? (result.value as {content?: string}).content
				: undefined;
		setView({id, content: typeof content === 'string' ? content : ''});
	}

	async function openLocation(id: string) {
		const result = await window.fastIde.dshSettings.agentPresetOpenDocument(id);
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		if (!result.value || typeof result.value !== 'object') return;
		const v = result.value as {opened?: boolean; path?: string};
		if (v.opened) return;
		if (typeof v.path === 'string') setRevealed(cur => ({...cur, [id]: v.path!}));
	}

	async function confirmCopy() {
		if (!copy || copyBusy) return;
		if (draftBlocker(copy, rows)) return;
		setCopyBusy(true);
		const result = await window.fastIde.dshSettings.agentPresetCopy(copyPayload(copy));
		if (!result.ok) {
			setNotice(failText(result.error));
			setCopyBusy(false);
			return;
		}
		const created = copy.id;
		setCopy(null);
		setCopyBusy(false);
		onReload();
		await loadRoster();
		await openLocation(created);
	}

	async function remove() {
		if (!pendingDelete) return;
		const result = await window.fastIde.dshSettings.agentPresetRemove(pendingDelete);
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		setPendingDelete(null);
		onReload();
		await loadRoster();
	}

	if (!loaded) {
		return <SettingsState status="loading" title={t.loading} />;
	}
	if (rows.length === 0) {
		return (
			<>
				<PageNotice text={notice} />
				<SettingsState status="empty" title={t.empty} description={t.emptyHint} />
			</>
		);
	}

	const groups = groupPresets(rows);
	const blocker = copy ? draftBlocker(copy, rows) : undefined;
	const sourceName = copy ? presetName(copy.from, rows.find(r => r.id === copy.from)?.name) : '';

	return (
		<div className="space-y-4">
			<PageNotice text={notice} />
			<p className="text-[12px] leading-relaxed text-muted-foreground">{t.intro}</p>
			<Group heading={t.builtIn} rows={groups.system} />
			<Group
				heading={t.custom}
				rows={groups.user}
				tail={
					rows.some(r => r.id === 'cordis') ? (
						<SettingsButton
							variant="outline"
							className="w-full border-dashed"
							disabled={!authorable}
							title={authorable ? undefined : t.duplicateUnavailable}
							onClick={() => void selectCurrent('cordis')}
						>
							{t.creatorDraft}
						</SettingsButton>
					) : null
				}
			/>
			{view ? (
				<Dialog
					title={`${t.view} · ${presetName(view.id)}`}
					description={t.composition}
					onClose={() => setView(null)}
					footer={
						<SettingsButton variant="outline" onClick={() => setView(null)}>
							{t.close}
						</SettingsButton>
					}
				>
					<pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
						{view.content || t.emptyContent}
					</pre>
				</Dialog>
			) : null}
			{copy ? (
				<Dialog
					title={`${t.copyTitle} · ${t.copyOf} ${sourceName}`}
					description={t.copyIntro}
					onClose={() => setCopy(null)}
					footer={
						<>
							<SettingsButton variant="outline" disabled={copyBusy} onClick={() => setCopy(null)}>
								{t.cancel}
							</SettingsButton>
							<SettingsButton disabled={!writable || copyBusy || blocker !== undefined} onClick={() => void confirmCopy()}>
								{copyBusy ? t.creating : t.create}
							</SettingsButton>
						</>
					}
				>
					<label className="block space-y-1">
						<span className="text-[12px] font-medium">{t.presetId}</span>
						<input
							className={`${settingsControlClass} w-full min-w-0`}
							value={copy.id}
							spellCheck={false}
							placeholder={t.presetIdPlaceholder}
							onChange={e => setCopy({...copy, id: e.target.value})}
						/>
					</label>
					<label className="block space-y-1">
						<span className="text-[12px] font-medium">{t.displayName}</span>
						<input
							className={`${settingsControlClass} w-full min-w-0`}
							value={copy.name}
							spellCheck={false}
							placeholder={t.displayNamePlaceholder}
							onChange={e => setCopy({...copy, name: e.target.value})}
						/>
					</label>
					{blocker ? <p className="text-[12px] text-destructive">{t[blocker]}</p> : null}
				</Dialog>
			) : null}
			{pendingDelete ? (
				<Dialog
					title={t.deleteTitle}
					description={t.deleteDescription}
					onClose={() => setPendingDelete(null)}
					footer={
						<>
							<SettingsButton variant="outline" onClick={() => setPendingDelete(null)}>
								{t.cancel}
							</SettingsButton>
							<SettingsButton variant="destructive" onClick={() => void remove()}>
								{t.deleteConfirm}
							</SettingsButton>
						</>
					}
				/>
			) : null}
		</div>
	);

	function Group({heading, rows: group, tail}: {heading: string; rows: PresetRow[]; tail?: ReactNode}) {
		if (group.length === 0 && !tail) return null;
		return (
			<section className="space-y-2">
				<h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</h3>
				{group.length > 0 ? (
					<ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
						{group.map(row => (
							<Card key={row.id} row={row} />
						))}
					</ul>
				) : null}
				{tail}
			</section>
		);
	}

	function Card({row}: {row: PresetRow}) {
		const name = presetName(row.id, row.name);
		const description = presetDescription(row.id, row.description) ?? t.noDescription;
		const inUse = current === row.id;
		const broken = row.broken !== undefined;
		return (
			<li>
				<SettingsSection className={row.isDefault ? 'border-foreground/40' : undefined}>
					<button
						type="button"
						className="flex w-full flex-col items-start gap-1.5 px-4 py-3 text-left disabled:opacity-60"
						disabled={!writable || row.isDefault || broken}
						title={broken ? row.broken : row.isDefault ? t.inUse : t.setDefault}
						onClick={() => void setDefault(row.id)}
					>
						<span className="flex w-full flex-wrap items-center gap-1.5">
							<span className="text-[13px] font-semibold text-foreground">{name}</span>
							<span className="rounded-md border border-border/60 px-1.5 text-[10px] text-muted-foreground">
								{row.trust === 'user' ? t.userTrust : t.builtInTag}
							</span>
							{row.isDefault ? (
								<span className="rounded-md bg-foreground px-1.5 text-[10px] text-background">{t.inUse}</span>
							) : null}
							{inUse && !row.isDefault ? (
								<span className="rounded-md border border-border/60 px-1.5 text-[10px]">{t.sessionUse}</span>
							) : null}
							{broken ? (
								<span className="rounded-md bg-destructive/10 px-1.5 text-[10px] text-destructive">
									{t.brokenBadge}
								</span>
							) : null}
						</span>
						<span className="text-[12px] leading-relaxed text-muted-foreground">{description}</span>
						{broken ? <span className="text-[11px] text-destructive">{row.broken}</span> : null}
						<code className="text-[11px] text-muted-foreground/80">{row.id}</code>
					</button>
					<div className="flex flex-wrap gap-1.5 px-4 py-2.5">
						{row.trust === 'system' && !broken ? (
							<SettingsButton variant="ghost" onClick={() => void read(row.id)}>
								{t.view}
							</SettingsButton>
						) : null}
						{row.trust === 'user' ? (
							<SettingsButton variant="ghost" onClick={() => void openLocation(row.id)}>
								{hasDocument ? t.openLocation : t.showLocation}
							</SettingsButton>
						) : null}
						<SettingsButton
							variant="ghost"
							disabled={!writable || !authorable || broken}
							title={broken ? t.brokenNoCopy : authorable ? undefined : t.duplicateUnavailable}
							onClick={() => setCopy({from: row.id, id: '', name: ''})}
						>
							{t.duplicate}
						</SettingsButton>
						<SettingsButton
							variant="outline"
							disabled={!sessionId || inUse || broken || !blank}
							onClick={() => void selectCurrent(row.id)}
						>
							{t.useSession}
						</SettingsButton>
						{row.trust === 'user' ? (
							<SettingsButton variant="ghost" disabled={!writable} onClick={() => setPendingDelete(row.id)}>
								{t.delete}
							</SettingsButton>
						) : null}
					</div>
					{revealed[row.id] ? (
						<p className="px-4 pb-3 text-[11px] text-muted-foreground">
							{t.revealedPathLabel} <code>{revealed[row.id]}</code>
						</p>
					) : null}
				</SettingsSection>
			</li>
		);
	}
}

function Dialog({
	title,
	description,
	onClose,
	footer,
	children
}: {
	title: string;
	description?: string;
	onClose: () => void;
	footer: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
			<div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-background shadow-lg">
				<div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
					<div>
						<h2 className="text-[14px] font-semibold">{title}</h2>
						{description ? <p className="mt-1 text-[12px] text-muted-foreground">{description}</p> : null}
					</div>
					<SettingsButton variant="ghost" onClick={onClose}>
						{t.close}
					</SettingsButton>
				</div>
				{children ? <div className="space-y-3 px-4 py-3">{children}</div> : null}
				<div className="flex justify-end gap-1.5 px-4 py-3">{footer}</div>
			</div>
		</div>
	);
}
