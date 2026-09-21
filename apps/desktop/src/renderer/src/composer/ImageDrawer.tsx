import {type Ref} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {IMAGE_ACCEPT, type PendingImage} from '../imageAttachments';

export function ImageDrawer({
	pendingImages,
	attachNotice,
	fileInputRef,
	onRemove,
	onPickFiles
}: {
	pendingImages: PendingImage[];
	attachNotice: string | null;
	fileInputRef: Ref<HTMLInputElement>;
	onRemove: (id: string) => void;
	onPickFiles: (files: File[]) => void;
}) {
	const {t} = useTranslation();
	return (
		<>
			{pendingImages.length > 0 ? (
				<div className="flex flex-wrap gap-2 border-b border-border/40 px-4 py-2">
					{pendingImages.map(img => (
						<div
							key={img.id}
							className={cn(
								'group relative flex items-center gap-2 rounded-lg border px-2 py-1.5',
								img.rejectReason
									? 'border-destructive/40 bg-destructive/5'
									: 'border-border/60 bg-muted/30'
							)}
							title={
								img.rejectReason === 'too_many'
									? t('shell.composer.imageTooMany')
									: img.rejectReason === 'unsupported'
										? t('shell.composer.imageUnsupportedType')
										: img.rejectReason === 'too_large'
											? t('shell.composer.imageTooLarge')
											: img.rejectReason === 'read_failed'
												? t('shell.composer.imageReadFailed')
												: img.name
							}
						>
							<img
								src={img.previewUrl}
								alt={img.name}
								className="size-10 rounded object-cover cursor-zoom-in"
								onClick={() => window.open(img.previewUrl, '_blank', 'noopener,noreferrer')}
							/>
							<div className="min-w-0 max-w-[7rem]">
								<div className="truncate text-[11px] font-medium">{img.name}</div>
								<div className="text-[10px] text-muted-foreground">
									{(img.size / 1024).toFixed(0)} KB
								</div>
							</div>
							<button
								type="button"
								className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow border border-border/60"
								aria-label={t('shell.composer.removeAttachment')}
								onClick={() => onRemove(img.id)}
							>
								<X className="size-3" />
							</button>
						</div>
					))}
				</div>
			) : null}
			{attachNotice ? (
				<div className="px-4 pt-2 text-[11px] text-amber-600 dark:text-amber-400">{attachNotice}</div>
			) : null}
			<input
				ref={fileInputRef}
				type="file"
				accept={IMAGE_ACCEPT}
				multiple
				className="hidden"
				onChange={e => {
					const files = e.target.files ? Array.from(e.target.files) : [];
					e.target.value = '';
					if (files.length) onPickFiles(files);
				}}
			/>
		</>
	);
}
