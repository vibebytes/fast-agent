/** Composer pending image attachments (multimodal-input §3.10). */

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type PendingImage = {
	id: string;
	mediaType: string;
	name: string;
	size: number;
	/** Object URL for thumbnail; revoke on remove/clear. */
	previewUrl: string;
	/** Wire base64 (no data: prefix). */
	data: string;
	/** Visible reject reason when over limit / wrong type; still shown in drawer. */
	rejectReason?: string;
};

export function supportsImageInput(entry: {inputModalities?: string[]} | undefined): boolean {
	return entry?.inputModalities?.includes('image') === true;
}

export function screenshotName(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `screenshot-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** Compress via canvas when over 5 MB; returns PNG/JPEG data URL payload. */
async function maybeCompress(file: File): Promise<{mediaType: string; data: string; size: number}> {
	const buf = await file.arrayBuffer();
	if (buf.byteLength <= MAX_IMAGE_BYTES) {
		return {
			mediaType: file.type || 'image/png',
			data: bytesToBase64(new Uint8Array(buf)),
			size: buf.byteLength
		};
	}
	const bitmap = await createImageBitmap(file);
	const scale = Math.sqrt(MAX_IMAGE_BYTES / buf.byteLength);
	const w = Math.max(1, Math.floor(bitmap.width * Math.min(1, scale)));
	const h = Math.max(1, Math.floor(bitmap.height * Math.min(1, scale)));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas unavailable');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
	const blob: Blob = await new Promise((resolve, reject) => {
		canvas.toBlob(
			b => (b ? resolve(b) : reject(new Error('compress failed'))),
			mime,
			0.85
		);
	});
	const out = new Uint8Array(await blob.arrayBuffer());
	return {mediaType: mime, data: bytesToBase64(out), size: out.byteLength};
}

export async function fileToPending(
	file: File,
	opts?: {defaultName?: string; alreadyCount: number}
): Promise<PendingImage> {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const name = opts?.defaultName || file.name || 'image.png';
	const previewUrl = URL.createObjectURL(file);
	const mt = (file.type || '').toLowerCase();
	if (!IMAGE_TYPES.has(mt)) {
		return {
			id,
			mediaType: mt || 'application/octet-stream',
			name,
			size: file.size,
			previewUrl,
			data: '',
			rejectReason: 'unsupported'
		};
	}
	if ((opts?.alreadyCount ?? 0) >= MAX_IMAGES) {
		return {
			id,
			mediaType: mt,
			name,
			size: file.size,
			previewUrl,
			data: '',
			rejectReason: 'too_many'
		};
	}
	try {
		const encoded = await maybeCompress(file);
		if (encoded.size > MAX_IMAGE_BYTES) {
			return {
				id,
				mediaType: encoded.mediaType,
				name,
				size: encoded.size,
				previewUrl,
				data: '',
				rejectReason: 'too_large'
			};
		}
		return {
			id,
			mediaType: encoded.mediaType,
			name,
			size: encoded.size,
			previewUrl,
			data: encoded.data
		};
	} catch {
		return {
			id,
			mediaType: mt,
			name,
			size: file.size,
			previewUrl,
			data: '',
			rejectReason: 'read_failed'
		};
	}
}

export function revokePending(items: PendingImage[]): void {
	for (const i of items) URL.revokeObjectURL(i.previewUrl);
}
