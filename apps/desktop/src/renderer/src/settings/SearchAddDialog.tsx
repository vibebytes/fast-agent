import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Input} from '@fast-ide/ui/components/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {SettingsButton} from './SettingsPrimitives';

type SearchHit = {
	modelId: string;
	displayName: string;
	vendorHint?: string | null;
	contextLength?: number | null;
};

function contextLabel(n?: number | null): string | null {
	if (!n || n <= 0) return null;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
}

export function SearchAddDialog({
	open,
	providerId,
	searchModels,
	patchModels,
	onOpenChange
}: {
	open: boolean;
	providerId: string;
	searchModels: (
		id: string,
		query: string
	) => Promise<{ok: true; models: SearchHit[]} | {ok: false; notice: string}>;
	patchModels: (
		id: string,
		patch: Array<{op: string; modelId: string; displayName?: string; enabled?: boolean}>
	) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
}) {
	const {t} = useTranslation();
	const [query, setQuery] = useState('');
	const [searching, setSearching] = useState(false);
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) {
			setQuery('');
			setHits([]);
			setSelected(new Set());
			setError(null);
			return;
		}
		void runSearch('');
	}, [open]);

	const runSearch = async (q: string) => {
		setSearching(true);
		setError(null);
		try {
			const res = await searchModels(providerId, q);
			if (res.ok) {
				setHits(res.models);
			} else {
				setError(res.notice);
				setHits([]);
			}
		} finally {
			setSearching(false);
		}
	};

	const toggle = (id: string) => {
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const save = async () => {
		if (selected.size === 0) return;
		setSaving(true);
		try {
			const patch = hits
				.filter(h => selected.has(h.modelId))
				.map(h => ({
					op: 'add',
					modelId: h.modelId,
					displayName: h.displayName,
					enabled: true
				}));
			const ok = await patchModels(providerId, patch);
			if (ok) onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.models.searchCatalog')}</DialogTitle>
					<DialogDescription>{t('settings.models.searchCatalogDescription')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="flex gap-2">
						<Input
							placeholder={t('settings.models.searchPlaceholder')}
							value={query}
							onChange={e => setQuery(e.target.value)}
							onKeyDown={e => {
								if (e.key === 'Enter') void runSearch(query);
							}}
						/>
						<SettingsButton
							variant="outline"
							disabled={searching}
							onClick={() => void runSearch(query)}
						>
							{searching ? t('settings.common.searching') : t('settings.models.searchButton')}
						</SettingsButton>
					</div>

					{error ? <p className="text-xs text-destructive">{error}</p> : null}

					<div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
						{hits.length === 0 && !searching ? (
							<p className="py-4 text-center text-xs text-muted-foreground">
								{t('settings.models.noSearchResults')}
							</p>
						) : null}
						{hits.map(hit => {
							const isChecked = selected.has(hit.modelId);
							const ctx = contextLabel(hit.contextLength);
							return (
								<label
									key={hit.modelId}
									className="flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 hover:bg-muted"
								>
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-medium">{hit.displayName}</span>
										<span className="block truncate font-mono text-xs text-muted-foreground">
											{hit.modelId}
											{hit.vendorHint ? ` · ${hit.vendorHint}` : ''}
											{ctx ? ` · ${ctx}` : ''}
										</span>
									</span>
									<input
										type="checkbox"
										checked={isChecked}
										onChange={() => toggle(hit.modelId)}
									/>
								</label>
							);
						})}
					</div>
				</div>

				<DialogFooter className="flex items-center justify-between">
					<span className="text-xs text-muted-foreground">
						{t('settings.models.selectedCount', {count: selected.size})}
					</span>
					<div className="flex gap-2">
						<SettingsButton variant="outline" onClick={() => onOpenChange(false)}>
							{t('shell.common.cancel')}
						</SettingsButton>
						<SettingsButton
							disabled={saving || selected.size === 0}
							onClick={() => void save()}
						>
							{saving
								? t('shell.common.saving')
								: t('settings.models.addSelected', {count: selected.size})}
						</SettingsButton>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
