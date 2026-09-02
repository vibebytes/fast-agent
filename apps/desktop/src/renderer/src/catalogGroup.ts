import type {ModelCatalogEntry} from './env';
import {getProviderBrand, type ProviderBrandInfo} from './modelBrand';

export type CatalogGroup = {
	providerKey: string;
	providerLabel: string;
	items: Array<{
		entry: ModelCatalogEntry;
		cleanName: string;
	}>;
};

/** Group key + chip label come from the Settings provider row, not vendor wire. */
export function catalogProvider(entry: ModelCatalogEntry): {
	providerKey: string;
	cleanName: string;
	providerLabel: string;
	brand: ProviderBrandInfo;
} {
	const idParts = entry.id.split('/');
	const providerKey = entry.providerId?.trim() || (idParts.length > 1 ? idParts[0]! : 'default');
	const fromId = idParts.length > 1 ? idParts.slice(1).join('/') : entry.id;
	const cleanName = entry.display && !entry.display.includes('/') ? entry.display : fromId;
	const providerName = entry.providerName?.trim() || undefined;
	const brand = getProviderBrand(providerKey, providerName);
	return {
		providerKey,
		cleanName,
		providerLabel: providerName || brand.name,
		brand
	};
}

export function groupCatalogEntries(entries: ModelCatalogEntry[]): CatalogGroup[] {
	const map = new Map<string, {label: string; items: CatalogGroup['items']}>();
	for (const entry of entries) {
		const {providerKey, cleanName, providerLabel} = catalogProvider(entry);
		const bucket = map.get(providerKey) ?? {label: providerLabel, items: []};
		bucket.items.push({entry, cleanName});
		map.set(providerKey, bucket);
	}
	return [...map.entries()].map(([providerKey, bucket]) => ({
		providerKey,
		providerLabel: bucket.label,
		items: bucket.items
	}));
}
