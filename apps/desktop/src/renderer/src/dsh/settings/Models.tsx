import {useEffect, useState} from 'react';
import {SettingsButton, SettingsRow, SettingsSection, SettingsState} from '../../settings/SettingsPrimitives';
import {failText, modelsCopy as t} from './copy';
import {PageNotice} from './Fields';
import {CustomProvider, ProviderEdit} from './ProviderEdit';
import {
	deriveKeyRef,
	joinProviders,
	type Cred,
	type ProviderEntry,
	type ProviderRow
} from './providerJoin';
import {dshMutate, nsOf, protocolChoices, type SettingsDescribe} from './settings';

export function Models({
	describe,
	onReload,
	writable
}: {
	describe: SettingsDescribe | null;
	onReload: () => void;
	writable: boolean;
}) {
	const [failures, setFailures] = useState<Array<{id: string; name: string; message: string}>>([]);
	const [rows, setRows] = useState<ProviderRow[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const [declaring, setDeclaring] = useState(false);

	async function load() {
		const [models, prov] = await Promise.all([
			window.fastIde.dshSettings.llmModels(),
			window.fastIde.dshSettings.llmProviders()
		]);
		setReady(true);
		if (models.ok && models.value && typeof models.value === 'object') {
			const v = models.value as {failures?: typeof failures};
			setFailures(Array.isArray(v.failures) ? v.failures : []);
		} else if (!models.ok) {
			setNotice(failText(models.error));
		}
		if (!prov.ok) {
			setNotice(failText(prov.error));
			return;
		}
		const entries = ((prov.value as {providers?: ProviderEntry[]} | undefined)?.providers ?? []).filter(
			p => p.settingsNs
		);
		const draft = joinProviders(entries, describe, {});
		const refs = [...new Set(draft.flatMap(r => (r.apiKeyEnv ? [r.apiKeyEnv] : [])))];
		let creds: Record<string, Cred> = {};
		if (refs.length > 0) {
			const desc = await window.fastIde.dshSettings.credentialsDescribe(refs);
			if (desc.ok && desc.value && typeof desc.value === 'object') {
				const map = (desc.value as {credentials?: Record<string, Cred>}).credentials;
				creds = map && typeof map === 'object' ? map : {};
			}
		}
		setRows(joinProviders(entries, describe, creds));
	}

	useEffect(() => {
		void load();
	}, [describe]);

	const configured = rows.filter(r => r.configured);
	const addable = rows.filter(r => !r.configured && r.entry.settingsNs);
	const addRow = adding ? addable.find(r => r.entry.provider === adding) : undefined;
	const protocols = protocolChoices(nsOf(describe, 'llm-pi-ai')?.schema);

	async function remove(row: ProviderRow) {
		const managed = row.apiKeyEnv && row.apiKeyEnv === deriveKeyRef(row.entry.provider) && row.credential?.writable;
		if (
			!window.confirm(
				`${t.deleteTitle}\n\n${managed ? t.deleteWithKey : t.deleteKeepKey}`
			)
		) {
			return;
		}
		if (managed && row.apiKeyEnv) {
			const unset = await window.fastIde.dshSettings.credentialsUnset(row.apiKeyEnv);
			if (!unset.ok) {
				setNotice(failText(unset.error));
				return;
			}
		}
		const mutated = await dshMutate(
			row.entry.settingsNs,
			[{op: 'unset', path: row.entry.settingsPath}],
			row.namespace?.revision
		);
		if (!mutated.ok) {
			setNotice(failText(mutated.error));
			return;
		}
		onReload();
	}

	function closeEditor(changed: boolean) {
		setEditing(null);
		setAdding(null);
		setDeclaring(false);
		if (changed) onReload();
	}

	if (!ready && rows.length === 0) {
		return <SettingsState status="loading" title="正在加载" />;
	}

	return (
		<div className="space-y-4">
			<PageNotice text={notice} />
			{failures.length > 0 ? (
				<SettingsSection title="目录加载失败" tone="danger">
					{failures.map(f => (
						<SettingsRow key={f.id} title={f.name} description={f.message} />
					))}
				</SettingsSection>
			) : null}
			<div className="space-y-2">
				{configured.map(row => {
					const open = !adding && editing === row.entry.provider;
					const missing = row.apiKeyEnv !== undefined && row.credential?.configured !== true;
					return (
						<SettingsSection key={row.entry.provider}>
							<SettingsRow
								title={row.entry.displayName}
								description={
									row.credential?.writable === false
										? `来自${row.credential.source === 'file' ? '文件' : '环境'}，只读`
										: undefined
								}
								badge={
									<span className="flex items-center gap-1.5">
										{row.entry.declared ? (
											<span className="rounded-md border border-border/60 px-1.5 text-[10px] text-muted-foreground">
												{t.customTag}
											</span>
										) : null}
										{row.credential?.configured ? (
											<span
												className="size-2 rounded-full bg-emerald-500"
												title={t.configured}
												aria-label={t.configured}
											/>
										) : missing ? (
											<span
												className="size-2 rounded-full bg-amber-500"
												title={t.missing}
												aria-label={t.missing}
											/>
										) : null}
									</span>
								}
							>
								<SettingsButton
									variant="outline"
									onClick={() => {
										setDeclaring(false);
										setAdding(null);
										setEditing(open ? null : row.entry.provider);
									}}
								>
									{t.edit}
								</SettingsButton>
								{row.removable && writable ? (
									<SettingsButton variant="ghost" onClick={() => void remove(row)}>
										{t.remove}
									</SettingsButton>
								) : null}
							</SettingsRow>
							{open && row.namespace ? (
								<ProviderEdit
									provider={row.entry.provider}
									displayName={row.entry.displayName}
									namespace={row.namespace}
									settingsPath={row.entry.settingsPath}
									declared={row.entry.declared}
									writable={writable}
									onClose={closeEditor}
								/>
							) : null}
						</SettingsSection>
					);
				})}
			</div>
			<SettingsSection>
				{addRow?.namespace ? (
					<div>
						<SettingsRow title={t.provider}>
							<select
								className="h-7 min-w-40 rounded-lg border border-input/80 bg-background/80 px-2.5 text-[12px]"
								value={addRow.entry.provider}
								onChange={e => setAdding(e.target.value)}
							>
								{addable.map(r => (
									<option key={r.entry.provider} value={r.entry.provider}>
										{r.entry.displayName}
									</option>
								))}
							</select>
						</SettingsRow>
						<ProviderEdit
							key={addRow.entry.provider}
							provider={addRow.entry.provider}
							displayName={addRow.entry.displayName}
							namespace={addRow.namespace}
							settingsPath={addRow.entry.settingsPath}
							declared={addRow.entry.declared}
							hideTitle
							writable={writable}
							onClose={closeEditor}
						/>
					</div>
				) : declaring ? (
					<CustomProvider
						taken={rows.map(r => r.entry.provider)}
						protocols={protocols}
						revision={nsOf(describe, 'llm-pi-ai')?.revision ?? 0}
						writable={writable}
						onClose={closeEditor}
					/>
				) : (
					<div className="grid grid-cols-2 gap-2 px-4 py-3">
						<SettingsButton
							variant="outline"
							className="h-10 justify-center border-dashed"
							disabled={!writable || addable.length === 0}
							onClick={() => {
								setEditing(null);
								setDeclaring(false);
								setAdding(addable[0]?.entry.provider ?? null);
							}}
						>
							+ {t.add}
						</SettingsButton>
						<SettingsButton
							variant="outline"
							className="h-10 justify-center border-dashed"
							disabled={!writable || protocols.length === 0}
							onClick={() => {
								setEditing(null);
								setAdding(null);
								setDeclaring(true);
							}}
						>
							+ {t.customAdd}
						</SettingsButton>
					</div>
				)}
			</SettingsSection>
		</div>
	);
}
