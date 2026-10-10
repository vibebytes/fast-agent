export type ModelCapabilityTag = 'image_generation';

export type CapabilityTag = {
	key: string;
	labelKey: string;
	reserved: boolean;
};

/** Editable tags can be granted from the settings UI; reserved tags are declared elsewhere only. */
export const CAPABILITY_TAGS: readonly CapabilityTag[] = [
	{key: 'image_generation', labelKey: 'settings.models.capabilities.image_generation', reserved: false},
	{key: 'video_generation', labelKey: 'settings.models.capabilities.video_generation', reserved: true},
	{key: 'tts', labelKey: 'settings.models.capabilities.tts', reserved: true},
	{key: 'asr', labelKey: 'settings.models.capabilities.asr', reserved: true},
	{key: 'ocr', labelKey: 'settings.models.capabilities.ocr', reserved: true},
	{key: 'video_caption', labelKey: 'settings.models.capabilities.video_caption', reserved: true}
];

export const EDITABLE_CAPABILITY_TAGS: readonly ModelCapabilityTag[] = CAPABILITY_TAGS.filter(
	tag => !tag.reserved
).map(tag => tag.key as ModelCapabilityTag);

export function hasCapability(model: {capabilities?: readonly string[]}, key: string): boolean {
	return Boolean(model.capabilities?.includes(key));
}

export function toggleCapability(capabilities: readonly string[] | undefined, key: string, on: boolean): string[] {
	const set = new Set(capabilities ?? []);
	if (on) set.add(key);
	else set.delete(key);
	return [...set];
}
