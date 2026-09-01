import {
	SettingsRow,
	SettingsSwitchRow,
	settingsControlClass
} from '../../settings/SettingsPrimitives';
import {enumLabel, fieldDescription, fieldTitle} from './copy';
import {schemaFields} from './settings';

export function PageNotice({text}: {text: string | null}) {
	if (!text) return null;
	return (
		<div
			role="alert"
			className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
		>
			{text}
		</div>
	);
}

export function SchemaFields({
	schema,
	value,
	disabled,
	onPatch
}: {
	schema: unknown;
	value: unknown;
	disabled?: boolean;
	onPatch: (key: string, next: unknown) => void;
}) {
	const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return (
		<>
			{schemaFields(schema).map(field => {
				const current = rec[field.key] ?? field.fallback;
				const title = fieldTitle(field.key, field.title);
				const description = fieldDescription(field.key, field.description);
				if (field.type === 'boolean') {
					return (
						<SettingsSwitchRow
							key={field.key}
							title={title}
							description={description}
							checked={current === true}
							disabled={disabled}
							onCheckedChange={checked => onPatch(field.key, checked)}
						/>
					);
				}
				if (field.enum && field.enum.length > 0) {
					return (
						<SettingsRow key={field.key} title={title} description={description}>
							<select
								className={settingsControlClass}
								value={typeof current === 'string' ? current : ''}
								disabled={disabled}
								onChange={e => onPatch(field.key, e.target.value)}
							>
								{(field.choices ?? field.enum.map(id => ({id, label: id}))).map(opt => (
									<option key={opt.id} value={opt.id}>
										{enumLabel(opt.id) !== opt.id ? enumLabel(opt.id) : opt.label}
									</option>
								))}
							</select>
						</SettingsRow>
					);
				}
				return (
					<SettingsRow key={field.key} title={title} description={description}>
						<input
							className={settingsControlClass}
							value={current == null ? '' : String(current)}
							disabled={disabled}
							onChange={e =>
								onPatch(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)
							}
						/>
					</SettingsRow>
				);
			})}
		</>
	);
}
