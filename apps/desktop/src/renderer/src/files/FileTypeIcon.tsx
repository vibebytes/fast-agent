import {useEffect, useState} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';
import {fileIconSrc} from './fileIcon';
import manifest from './fileIconManifest.json';

export function FileTypeIcon({
	name,
	className,
	size = 14
}: {
	/** File basename, e.g. `app.tsx`. */
	name: string;
	className?: string;
	size?: number;
}) {
	const primary = fileIconSrc(name);
	const fallback = `${import.meta.env.BASE_URL || './'}file-icons/${manifest.file}.svg`;
	const [src, setSrc] = useState(primary);

	useEffect(() => {
		setSrc(primary);
	}, [primary]);

	return (
		<img
			src={src}
			alt=""
			width={size}
			height={size}
			draggable={false}
			className={cn('shrink-0', className)}
			aria-hidden
			onError={() => {
				if (src !== fallback) setSrc(fallback);
			}}
		/>
	);
}
