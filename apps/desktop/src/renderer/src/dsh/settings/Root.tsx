import {useCallback, useState, type ReactNode} from 'react';
import {SettingsButton, SettingsPageHeader, SettingsState} from '../../settings/SettingsPrimitives';
import {SettingsShell} from '../../settings/SettingsShell';
import {AgentPresets} from './AgentPresets';
import {failText} from './copy';
import {General, useDescribeOnFocus} from './General';
import {Models} from './Models';
import {dshSections, type DshSection} from './nav';
import {Plugins} from './Plugins';
import {dshDescribe, type SettingsDescribe} from './settings';

async function openDocument(): Promise<void> {
	await window.fastIde.dshSettings.openDocument();
}

export function Root({
	onBack,
	headerExtra,
	sessionId,
	initialSection
}: {
	onBack: () => void;
	headerExtra?: ReactNode;
	sessionId?: string;
	initialSection?: DshSection;
}) {
	const [section, setSection] = useState<DshSection>(initialSection ?? 'general');
	const [describe, setDescribe] = useState<SettingsDescribe | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(() => {
		setLoading(true);
		void dshDescribe().then(result => {
			setLoading(false);
			if (!result.ok) {
				setError(failText(result.error));
				setDescribe(null);
				return;
			}
			setError(null);
			setDescribe(result.value);
		});
	}, []);

	useDescribeOnFocus(load);

	const meta = dshSections.find(s => s.id === section)!;
	const writable = describe?.writable !== false;

	return (
		<SettingsShell
			sections={dshSections}
			activeSection={section}
			onSectionChange={setSection}
			onBack={onBack}
			headerExtra={headerExtra}
		>
			<SettingsPageHeader icon={meta.icon} title={meta.title} description={meta.description} />
			{describe?.hasDocument ? (
				<div className="-mt-2 mb-4">
					<SettingsButton variant="outline" onClick={() => void openDocument()}>
						打开配置文件
					</SettingsButton>
				</div>
			) : null}
			{error ? (
				<SettingsState status="error" title="无法加载 DSH 设置" description={error} onRetry={load} />
			) : loading && !describe ? (
				<SettingsState status="loading" title="正在加载" />
			) : section === 'general' ? (
				<General describe={describe} onReload={load} writable={writable} />
			) : section === 'models' ? (
				<Models describe={describe} onReload={load} writable={writable} />
			) : section === 'plugins' ? (
				<Plugins describe={describe} onReload={load} writable={writable} />
			) : (
				<AgentPresets
					describe={describe}
					onReload={load}
					writable={writable}
					sessionId={sessionId}
				/>
			)}
		</SettingsShell>
	);
}
