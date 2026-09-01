import {useEffect, useState} from 'react';
import {SettingsRow, SettingsSection, settingsControlClass} from '../../settings/SettingsPrimitives';
import {enumLabel, failText, nsDescription, nsTitle, presetName} from './copy';
import {PageNotice} from './Fields';
import {dshMutate, dshUpdate, fieldValue, nsOf, schemaFields, type SettingsDescribe} from './settings';

/** DSH-Web `settings.general.item` order, minus `ui-theme` (Fast owns appearance). */
const GENERAL_ROWS = [
	{ns: 'agent-presets', key: 'default'},
	{ns: 'permission', key: 'defaultPreset'},
	{ns: 'locale', key: 'preference'},
	{ns: 'ui-conversation', key: 'busyEnter'}
] as const;

const FULL_ACCESS = 'danger-full-access';

export function General({
	describe,
	onReload,
	writable
}: {
	describe: SettingsDescribe | null;
	onReload: () => void;
	writable: boolean;
}) {
	const [notice, setNotice] = useState<string | null>(null);
	const [presets, setPresets] = useState<Array<{id: string; name?: string}>>([]);

	useEffect(() => {
		void window.fastIde.dshSettings.agentPresetList().then(list => {
			if (!list.ok) {
				setNotice(failText(list.error));
				return;
			}
			if (!list.value || typeof list.value !== 'object') return;
			const rows = (list.value as {presets?: Array<{id?: string; name?: string}>}).presets;
			setPresets((rows ?? []).flatMap(r => (r.id ? [{id: r.id, name: r.name}] : [])));
		});
	}, [describe]);

	useEffect(() => {
		setNotice(null);
	}, [describe]);

	async function write(ns: string, key: string, next: unknown, revision?: number) {
		const result =
			ns === 'permission'
				? await dshMutate(ns, [{op: 'set', path: [key], value: next}], revision)
				: await dshUpdate(ns, {[key]: next}, revision);
		if (!result.ok) {
			setNotice(failText(result.error));
			return;
		}
		onReload();
	}

	function onSelect(ns: string, key: string, next: string, revision?: number) {
		if (ns === 'permission' && next === FULL_ACCESS) {
			if (!window.confirm('确认启用 Full access？\n\n启用 Full access 后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。')) {
				return;
			}
		}
		void write(ns, key, next, revision);
	}

	return (
		<div className="space-y-4">
			<PageNotice text={notice} />
			<SettingsSection>
				{GENERAL_ROWS.map(({ns, key}) => {
					const view = nsOf(describe, ns);
					const field = schemaFields(view?.schema).find(f => f.key === key);
					const raw = fieldValue(view?.value, key, fieldValue(view?.base, key, field?.fallback));
					const current = typeof raw === 'string' ? raw : ns === 'locale' ? 'zh' : '';
					const options =
						ns === 'agent-presets'
							? presets.map(p => ({id: p.id, label: presetName(p.id, p.name)}))
							: (field?.choices ?? field?.enum?.map(id => ({id, label: id})) ?? []).map(opt => ({
									id: opt.id,
									label: enumLabel(opt.id)
								}));
					return (
						<SettingsRow key={ns} title={nsTitle(ns)} description={nsDescription(ns)}>
							<select
								className={settingsControlClass}
								value={current}
								disabled={!writable || !view}
								onChange={e => onSelect(ns, key, e.target.value, view?.revision)}
							>
								{options.map(opt => (
									<option key={opt.id} value={opt.id}>
										{opt.label}
									</option>
								))}
							</select>
						</SettingsRow>
					);
				})}
			</SettingsSection>
		</div>
	);
}

export function useDescribeOnFocus(load: () => void): void {
	useEffect(() => {
		load();
		const onFocus = () => load();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [load]);
}
