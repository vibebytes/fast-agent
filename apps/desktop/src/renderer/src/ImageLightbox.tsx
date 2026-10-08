import {useEffect} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';

/**
 * In-app image zoom overlay. `window.open(dataUrl)` yields a blank Electron window
 * because data: URLs are not navigable, so previews render here instead.
 */
export function ImageLightbox({
	src,
	alt,
	onClose
}: {
	src: string | null;
	alt?: string;
	onClose: () => void;
}) {
	useEffect(() => {
		if (!src) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [src, onClose]);

	if (!src) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
		>
			<button
				type="button"
				className={cn(
					'absolute top-4 right-4 inline-flex size-9 cursor-pointer items-center justify-center rounded-full',
					'bg-white/10 text-white transition-colors hover:bg-white/20'
				)}
				aria-label="Close"
				onClick={onClose}
			>
				<X className="size-5" />
			</button>
			<img
				src={src}
				alt={alt ?? 'attachment'}
				className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
				onClick={e => e.stopPropagation()}
			/>
		</div>,
		document.body
	);
}
