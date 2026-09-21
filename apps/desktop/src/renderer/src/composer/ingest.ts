import {type AtItem} from '../atCatalog';
import {
	fileToPending,
	IMAGE_ACCEPT,
	screenshotName,
	type PendingImage
} from '../imageAttachments';

export async function ingestFiles(
	files: File[],
	opts: {
		fromPaste?: boolean;
		canAttachImages: boolean;
		pendingImages: PendingImage[];
		unsupportedNotice: string;
		pickAt: (item: AtItem) => void;
		setPendingImages: (updater: (prev: PendingImage[]) => PendingImage[]) => void;
		setAttachNotice: (notice: string | null) => void;
	}
): Promise<void> {
	if (!opts.canAttachImages) {
		const hasImage = files.some(f => IMAGE_ACCEPT.split(',').includes(f.type) || f.type.startsWith('image/'));
		if (hasImage) {
			opts.setAttachNotice(opts.unsupportedNotice);
			return;
		}
	}
	const acceptedCount = opts.pendingImages.filter(p => !p.rejectReason && p.data).length;
	let nextAccepted = acceptedCount;
	const additions: PendingImage[] = [];
	for (const f of files) {
		const path = window.fastIde.getPathForFile(f);
		const isImage =
			IMAGE_ACCEPT.split(',').includes(f.type) ||
			/\.(png|jpe?g|webp|gif)$/i.test(f.name);
		if (isImage && opts.canAttachImages) {
			const defaultName =
				!path && opts.fromPaste ? screenshotName() : undefined;
			const pending = await fileToPending(f, {
				defaultName,
				alreadyCount: nextAccepted
			});
			if (!pending.rejectReason && pending.data) nextAccepted += 1;
			additions.push(pending);
			continue;
		}
		if (path) {
			opts.pickAt({
				ref: `@file/${path}`,
				label: path.split(/[\\/]/).pop() || path,
				description: path,
				kind: 'file',
				locator: path
			});
		}
	}
	if (additions.length) {
		opts.setPendingImages(prev => [...prev, ...additions]);
		opts.setAttachNotice(null);
	}
}
