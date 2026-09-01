import {useEffect, useState} from 'react';
import {SettingsButton, SettingsRow, settingsControlClass} from '../../settings/SettingsPrimitives';
import {failText, modelsCopy as t} from './copy';
import {
	asRecord,
	deriveKeyRef,
	catalogRows,
	keyFailure,
	modelIssue,
	pathOps,
	ROUTE_PATTERN,
	type Cred
} from './providerJoin';
import {atPath, dshMutate, type SettingsNs} from './settings';

const DEEPSEEK_URL = 'https://api.deepseek.com';

type Model = {id: string; name?: string};

function Catalog({
	models,
	emptyHint,
	disabled,
	onChange,
	fetchLabel,
	onFetch
}: {
	models: Model[];
	emptyHint: boolean;
	disabled: boolean;
	onChange: (next: Model[]) => void;
	fetchLabel?: string;
	onFetch?: () => void;
}) {
	return (
		<div className="space-y-2 px-4 py-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[12px] font-medium text-foreground">{t.models}</span>
				{onFetch ? (
					<SettingsButton variant="ghost" disabled={disabled} onClick={onFetch}>
						{fetchLabel ?? t.fetchModels}
					</SettingsButton>
				) : null}
			</div>
			{models.length === 0 && emptyHint ? (
				<p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
					{t.modelsEmpty}
				</p>
			) : (
				models.map((m, i) => (
					<div key={`${m.id}-${i}`} className="flex items-center gap-2">
						<input
							className={`${settingsControlClass} min-w-0 flex-1`}
							placeholder={t.modelId}
							value={m.id}
							disabled={disabled}
							onChange={e =>
								onChange(models.map((row, j) => (j === i ? {...row, id: e.target.value} : row)))
							}
						/>
						<input
							className={`${settingsControlClass} min-w-0 flex-1`}
							placeholder={t.modelName}
							value={m.name ?? ''}
							disabled={disabled}
							onChange={e =>
								onChange(models.map((row, j) => (j === i ? {...row, name: e.target.value} : row)))
							}
						/>
						<SettingsButton
							variant="ghost"
							disabled={disabled}
							onClick={() => onChange(models.filter((_, j) => j !== i))}
						>
							{t.remove}
						</SettingsButton>
					</div>
				))
			)}
			<SettingsButton
				variant="outline"
				disabled={disabled}
				onClick={() => onChange([...models, {id: '', name: ''}])}
			>
				{t.addModel}
			</SettingsButton>
		</div>
	);
}

export function ProviderEdit({
	provider,
	displayName,
	namespace,
	settingsPath,
	declared,
	hideTitle,
	writable,
	onClose
}: {
	provider: string;
	displayName: string;
	namespace: SettingsNs;
	settingsPath: string[];
	declared?: boolean;
	hideTitle?: boolean;
	writable: boolean;
	onClose: (changed: boolean) => void;
}) {
	const [draft, setDraft] = useState(() => asRecord(atPath(namespace.user, settingsPath)));
	const [keyDraft, setKeyDraft] = useState('');
	const [keyState, setKeyState] = useState<Cred | undefined>();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [openCustom, setOpenCustom] = useState(false);
	const [original] = useState(() => atPath(namespace.user, settingsPath));
	const fallback = atPath(namespace.value, settingsPath);
	const family = namespace.ns === 'llm-deepseek' ? 'deepseek' : namespace.ns === 'llm-pi-ai' ? 'pi-ai' : 'unknown';
	const keyRef =
		typeof (fallback as {apiKeyEnv?: unknown} | undefined)?.apiKeyEnv === 'string'
			? ((fallback as {apiKeyEnv: string}).apiKeyEnv)
			: deriveKeyRef(provider);
	const inherited = catalogRows(
		atPath(namespace.base, [...settingsPath, 'models']) ?? atPath(fallback, ['models'])
	);
	const overridden = 'models' in draft;
	const models = overridden ? catalogRows(draft.models) : inherited;
	const catalogFail = overridden ? modelIssue(models) : undefined;
	const locked = keyState?.writable === false;
	const fail = keyFailure(keyDraft);
	const disabled = !writable || busy;

	useEffect(() => {
		void window.fastIde.dshSettings.credentialsDescribe([keyRef]).then(result => {
			if (!result.ok || !result.value || typeof result.value !== 'object') return;
			const map = (result.value as {credentials?: Record<string, Cred>}).credentials;
			if (map) setKeyState(map[keyRef]);
		});
	}, [keyRef]);

	function setField(key: string, next: string | undefined) {
		setDraft(cur => {
			const copy = {...cur};
			if (next === undefined || next.trim() === '') delete copy[key];
			else copy[key] = next.trim();
			return copy;
		});
	}

	async function save() {
		setBusy(true);
		setNotice(null);
		if (overridden) {
			const issue = modelIssue(models);
			if (issue) {
				setNotice(`模型 ${issue.index + 1}: ${t[issue.key]}`);
				setBusy(false);
				return;
			}
		}
		const keyValue = keyDraft.trim();
		const next =
			family === 'pi-ai' && !draft.apiKeyEnv && keyValue
				? {...draft, apiKeyEnv: keyRef}
				: draft;
		const ops = pathOps(settingsPath, original, next);
		if (ops.length > 0) {
			const mutated = await dshMutate(namespace.ns, ops, namespace.revision);
			if (!mutated.ok) {
				setNotice(mutated.error.code === 'settings-conflict' ? t.conflict : failText(mutated.error));
				setBusy(false);
				return;
			}
		}
		if (keyValue) {
			const set = await window.fastIde.dshSettings.credentialsSet(keyRef, keyValue);
			if (!set.ok) {
				setNotice(failText(set.error));
				setBusy(false);
				return;
			}
		}
		setBusy(false);
		onClose(true);
	}

	async function fetchModels() {
		const baseURL = typeof draft.baseURL === 'string' ? draft.baseURL : undefined;
		if (family === 'pi-ai' && declared && !baseURL) {
			setNotice(t.fetchNeedsBaseUrl);
			return;
		}
		const result = await window.fastIde.dshSettings.llmDiscoverModels({
			settingsNs: namespace.ns,
			provider,
			...(baseURL ? {baseURL} : {}),
			...(typeof draft.api === 'string' ? {api: draft.api} : {}),
			...(keyDraft.trim() ? {apiKey: keyDraft.trim()} : {})
		});
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		const rows = (result.value as {models?: Model[]} | undefined)?.models;
		if (!Array.isArray(rows) || rows.length === 0) {
			setNotice(t.modelsEmpty);
			return;
		}
		setDraft(cur => ({...cur, models: rows.map(m => ({id: m.id, ...(m.name ? {name: m.name} : {})}))}));
	}

	const keyPlaceholder = locked
		? t.keyEnvLocked
		: keyState?.configured
			? t.keyStored
			: family === 'pi-ai'
				? t.keyPlaceholderNative
				: t.keyPlaceholder;

	return (
		<div className="border-t border-border/40">
			{hideTitle ? null : (
				<SettingsRow
					title={displayName}
					description={provider !== displayName ? provider : undefined}
				/>
			)}
			<SettingsRow title={t.keyInput} description={fail ? t[fail] : undefined}>
				<input
					className={`${settingsControlClass} min-w-56`}
					type="password"
					autoComplete="off"
					placeholder={keyPlaceholder}
					value={keyDraft}
					disabled={disabled || locked}
					onChange={e => setKeyDraft(e.target.value)}
				/>
			</SettingsRow>
			<button
				type="button"
				className="flex w-full items-center justify-between px-4 py-2 text-left text-[12px] text-muted-foreground"
				onClick={() => setOpenCustom(v => !v)}
			>
				{t.customized}
				<span>{openCustom ? '▾' : '▸'}</span>
			</button>
			{openCustom ? (
				<>
					<SettingsRow title={t.baseUrl}>
						<input
							className={`${settingsControlClass} min-w-56`}
							placeholder={family === 'deepseek' ? DEEPSEEK_URL : t.baseUrlDefault}
							value={typeof draft.baseURL === 'string' ? draft.baseURL : ''}
							disabled={disabled}
							onChange={e => setField('baseURL', e.target.value)}
						/>
					</SettingsRow>
					<p className="px-4 pt-1 text-[11px] text-muted-foreground">
						{overridden ? t.modelsCustomized : t.modelsInherited}
						{overridden ? (
							<SettingsButton
								variant="ghost"
								disabled={disabled}
								onClick={() =>
									setDraft(cur => {
										const copy = {...cur};
										delete copy.models;
										return copy;
									})
								}
							>
								{t.resetModels}
							</SettingsButton>
						) : null}
					</p>
					<Catalog
						models={models}
						emptyHint={overridden || family === 'pi-ai'}
						disabled={disabled}
						onChange={next => setDraft(cur => ({...cur, models: next}))}
						onFetch={family === 'pi-ai' ? () => void fetchModels() : undefined}
					/>
					{catalogFail ? (
						<p className="px-4 pb-2 text-[12px] text-destructive">
							{`模型 ${catalogFail.index + 1}: ${t[catalogFail.key]}`}
						</p>
					) : null}
				</>
			) : null}
			{notice ? <p className="px-4 py-2 text-[12px] text-destructive">{notice}</p> : null}
			<div className="flex justify-end gap-1.5 px-4 py-3">
				<SettingsButton variant="outline" disabled={busy} onClick={() => onClose(false)}>
					{t.cancel}
				</SettingsButton>
				<SettingsButton
					disabled={disabled || fail !== undefined || catalogFail !== undefined}
					onClick={() => void save()}
				>
					{t.apply}
				</SettingsButton>
			</div>
		</div>
	);
}

export function CustomProvider({
	taken,
	protocols,
	revision,
	writable,
	onClose
}: {
	taken: string[];
	protocols: string[];
	revision: number;
	writable: boolean;
	onClose: (changed: boolean) => void;
}) {
	const [route, setRoute] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [baseURL, setBaseURL] = useState('');
	const [api, setApi] = useState(protocols[0] ?? 'openai-completions');
	const [keyDraft, setKeyDraft] = useState('');
	const [models, setModels] = useState<Model[]>([]);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const invalid = route.length > 0 && !ROUTE_PATTERN.test(route);
	const takenId = taken.includes(route);
	const fail = keyFailure(keyDraft);
	const ready = route.length > 0 && !invalid && !takenId && baseURL.length > 0 && models.some(m => m.id.trim());
	const disabled = !writable || busy;

	async function create() {
		if (!ready) {
			setNotice(!baseURL ? t.customNeedsBaseUrl : t.customNeedsModels);
			return;
		}
		setBusy(true);
		setNotice(null);
		const keyRef = deriveKeyRef(route);
		const keyValue = keyDraft.trim();
		const profile = {
			...(displayName.trim() ? {displayName: displayName.trim()} : {}),
			...(keyValue ? {apiKeyEnv: keyRef} : {}),
			api,
			baseURL,
			models: models.filter(m => m.id.trim()).map(m => ({id: m.id.trim(), ...(m.name?.trim() ? {name: m.name.trim()} : {})}))
		};
		const mutated = await dshMutate('llm-pi-ai', [{op: 'set', path: ['providers', route], value: profile}], revision);
		if (!mutated.ok) {
			setNotice(failText(mutated.error));
			setBusy(false);
			return;
		}
		if (keyValue) {
			const set = await window.fastIde.dshSettings.credentialsSet(keyRef, keyValue);
			if (!set.ok) {
				setNotice(failText(set.error));
				setBusy(false);
				return;
			}
		}
		setBusy(false);
		onClose(true);
	}

	return (
		<div className="space-y-0">
			<SettingsRow title={t.customTitle} />
			<SettingsRow title={t.customRoute} description={invalid ? t.customRouteInvalid : takenId ? t.customRouteTaken : t.customRouteHint}>
				<input
					className={`${settingsControlClass} min-w-56`}
					placeholder="acme-gateway"
					value={route}
					disabled={disabled}
					onChange={e => setRoute(e.target.value)}
				/>
			</SettingsRow>
			<SettingsRow title={t.customDisplayName}>
				<input
					className={`${settingsControlClass} min-w-56`}
					placeholder={t.customDisplayName}
					value={displayName}
					disabled={disabled}
					onChange={e => setDisplayName(e.target.value)}
				/>
			</SettingsRow>
			<SettingsRow title={t.baseUrl}>
				<input
					className={`${settingsControlClass} min-w-56`}
					placeholder="https://gateway.example/v1"
					value={baseURL}
					disabled={disabled}
					onChange={e => setBaseURL(e.target.value)}
				/>
			</SettingsRow>
			<SettingsRow title={t.customApi}>
				<select
					className={settingsControlClass}
					value={api}
					disabled={disabled}
					onChange={e => setApi(e.target.value)}
				>
					{protocols.map(p => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</select>
			</SettingsRow>
			<SettingsRow title={t.keyInput} description={fail ? t[fail] : undefined}>
				<input
					className={`${settingsControlClass} min-w-56`}
					type="password"
					placeholder={t.keyPlaceholder}
					value={keyDraft}
					disabled={disabled}
					onChange={e => setKeyDraft(e.target.value)}
				/>
			</SettingsRow>
			<Catalog models={models} emptyHint disabled={disabled} onChange={setModels} />
			{notice ? <p className="px-4 py-2 text-[12px] text-destructive">{notice}</p> : null}
			<div className="flex justify-end gap-1.5 px-4 py-3">
				<SettingsButton variant="outline" disabled={busy} onClick={() => onClose(false)}>
					{t.cancel}
				</SettingsButton>
				<SettingsButton disabled={disabled || !ready || fail !== undefined} onClick={() => void create()}>
					{t.create}
				</SettingsButton>
			</div>
		</div>
	);
}
