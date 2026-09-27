import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Input} from '@fast-ide/ui/components/input';
import type {SettingsDoc} from '@fast-ide/session-view';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	SettingsSwitchRow
} from './SettingsPrimitives';
import {useExtensions} from './useExtensions';
import {useSettings} from './useSettings';
import {experimentalForm, type ExperimentalDoc, type ExperimentalSave} from './experimentalForm';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function docOf(docs: SettingsDoc[]): ExperimentalDoc | null {
	const row = docs.find(item => item.namespace === 'jev-context');
	if (!row || !isRecord(row.payload)) return null;
	return {
		jevContext: row.payload.jevContext === true,
		secretId: typeof row.payload.secretId === 'string' ? row.payload.secretId : null,
		last4: typeof row.payload.last4 === 'string' ? row.payload.last4 : null
	};
}

export function ExperimentalSettings({engineReady}: {engineReady: boolean}) {
	const {t} = useTranslation();
	const settings = useSettings(engineReady);
	const exts = useExtensions(engineReady);
	const doc = docOf(settings.docs);
	const active = exts.extensions.some(row => row.id === 'jev-context' && row.phase === 'Active');
	const signature = doc ? `${doc.jevContext}:${doc.secretId ?? ''}:${doc.last4 ?? ''}` : 'missing';
	const [draftOn, setDraftOn] = useState(false);
	const [secret, setSecret] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		setDraftOn(doc?.jevContext === true);
		setSecret('');
	}, [signature, doc?.jevContext]);

	if (!engineReady || settings.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.general.engineUnavailable')}
				description={t('settings.general.engineUnavailableDescription')}
			/>
		);
	}
	if (settings.status === 'loading' || exts.status === 'loading') {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (settings.status === 'error') {
		return (
			<SettingsState
				status="error"
				title={t('settings.general.loadFailed')}
				description={settings.notice ?? t('settings.general.loadFailedDescription')}
				onRetry={settings.retry}
			/>
		);
	}

	const view = experimentalForm({
		phaseActive: active,
		doc,
		draftOn,
		draftSecret: secret,
		clear: false
	});

	async function persist(body: ExperimentalSave): Promise<void> {
		setBusy(true);
		try {
			const res = await window.fastIde.saveExperimental(body);
			if (!res.ok) setNotice(res.notice);
			else {
				setNotice(null);
				setSecret('');
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<SettingsSection title={t('settings.navigation.experimental')}>
			{view.showSwitch ? (
				<SettingsSwitchRow
					title={t('settings.experimental.useJev')}
					description={t('settings.experimental.useJevDescription')}
					checked={draftOn}
					disabled={busy}
					onCheckedChange={setDraftOn}
				/>
			) : null}
			{view.showKey ? (
				<div className="space-y-2 px-4 py-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.experimental.key')}</span>
						<Input
							type="password"
							autoComplete="new-password"
							value={secret}
							disabled={busy}
							onChange={event => setSecret(event.target.value)}
						/>
					</label>
					{view.last4 ? (
						<p className="text-xs text-muted-foreground">
							{t('settings.experimental.saved', {last4: view.last4})}
						</p>
					) : null}
					{view.save == null ? (
						<p className="text-xs text-muted-foreground">{t('settings.experimental.needKey')}</p>
					) : null}
					{doc?.secretId ? (
						<SettingsButton
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => {
								const next = experimentalForm({
									phaseActive: active,
									doc,
									draftOn,
									draftSecret: secret,
									clear: true
								});
								if (next.save) void persist(next.save);
							}}
						>
							{t('settings.experimental.clear')}
						</SettingsButton>
					) : null}
				</div>
			) : null}
			{view.showSwitch ? (
				<div className="flex items-center justify-end px-4 py-3">
					<SettingsButton
						type="button"
						disabled={busy || view.save == null}
						onClick={() => {
							if (view.save) void persist(view.save);
						}}
					>
						{t('settings.experimental.save')}
					</SettingsButton>
				</div>
			) : null}
			{notice ? (
				<div className="px-4 py-2 text-xs text-destructive bg-destructive/10">{notice}</div>
			) : null}
		</SettingsSection>
	);
}
