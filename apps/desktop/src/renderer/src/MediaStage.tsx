import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Maximize2, Minimize2, Pause, Play, Volume2, VolumeX} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';
import {ImageLightbox} from './ImageLightbox';
import {ProjectImage, toProjectMediaUrl} from './MarkdownMessage';
import type {MediaArtifact} from './toolMedia';

function clock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const whole = Math.floor(seconds);
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const secs = String(whole % 60).padStart(2, '0');
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`;
	return `${minutes}:${secs}`;
}

function usePlayback<T extends HTMLMediaElement>(src: string) {
	const ref = useRef<T>(null);
	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(false);
	const [current, setCurrent] = useState(0);
	const [duration, setDuration] = useState(0);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		setPlaying(false);
		setCurrent(0);
		setDuration(0);
		setFailed(false);
	}, [src]);

	const toggle = () => {
		const el = ref.current;
		if (!el) return;
		if (el.paused) void el.play().catch(() => setFailed(true));
		else el.pause();
	};

	const seek = (next: number) => {
		const el = ref.current;
		if (!el) return;
		el.currentTime = next;
		setCurrent(next);
	};

	const events = {
		src: toProjectMediaUrl(src),
		preload: 'metadata' as const,
		onPlay: () => setPlaying(true),
		onPause: () => setPlaying(false),
		onTimeUpdate: () => setCurrent(ref.current?.currentTime ?? 0),
		onLoadedMetadata: () => setDuration(ref.current?.duration ?? 0),
		onDurationChange: () => setDuration(ref.current?.duration ?? 0),
		onError: () => setFailed(true)
	};

	return {ref, events, playing, muted, setMuted, current, duration, failed, toggle, seek};
}

function Scrub({
	current,
	duration,
	onSeek,
	tone
}: {
	current: number;
	duration: number;
	onSeek: (next: number) => void;
	tone: 'light' | 'ink';
}) {
	const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
	const fill = tone === 'light' ? 'rgba(255,255,255,.92)' : 'currentColor';
	const rest = tone === 'light' ? 'rgba(255,255,255,.28)' : 'color-mix(in oklab, currentColor 18%, transparent)';
	return (
		<input
			type="range"
			min={0}
			max={duration || 0}
			step={0.01}
			value={Number.isFinite(current) ? current : 0}
			aria-label="播放位置"
			onChange={event => onSeek(Number(event.target.value))}
			className={cn(
				'h-1 w-full cursor-pointer appearance-none rounded-full',
				'[&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
				tone === 'light'
					? '[&::-webkit-slider-thumb]:bg-white'
					: '[&::-webkit-slider-thumb]:bg-foreground'
			)}
			style={{background: `linear-gradient(to right, ${fill} ${pct}%, ${rest} ${pct}%)`}}
		/>
	);
}

function VideoStage({path}: {path: string}) {
	const play = usePlayback<HTMLVideoElement>(path);
	const frame = useRef<HTMLDivElement>(null);
	const [full, setFull] = useState(false);

	useEffect(() => {
		const sync = () => setFull(document.fullscreenElement === frame.current);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	}, []);

	if (play.failed) return <Unavailable label="视频无法播放" />;
	return (
		<div ref={frame} className={cn('relative bg-black', full && 'h-full w-full')}>
			<video
				className={cn(
					'w-full cursor-pointer bg-black',
					full ? 'h-full object-contain' : 'max-h-72'
				)}
				{...play.events}
				ref={play.ref}
				onClick={play.toggle}
			/>
			<div
				className={cn(
					'flex items-center gap-2 px-2.5 py-1.5 text-white',
					full && 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-8'
				)}
			>
				<RoundButton label={play.playing ? '暂停' : '播放'} onClick={play.toggle} light>
					{play.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
				</RoundButton>
				<span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-white/80">
					{clock(play.current)}
					<span className="text-white/40"> / {clock(play.duration)}</span>
				</span>
				<div className="min-w-0 flex-1">
					<Scrub current={play.current} duration={play.duration} onSeek={play.seek} tone="light" />
				</div>
				<RoundButton
					label={play.muted ? '打开声音' : '静音'}
					light
					onClick={() => {
						const el = play.ref.current;
						if (!el) return;
						el.muted = !el.muted;
						play.setMuted(el.muted);
					}}
				>
					{play.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
				</RoundButton>
				<RoundButton
					label={full ? '退出全屏' : '全屏'}
					light
					onClick={() => {
						const node = frame.current;
						if (!node) return;
						if (document.fullscreenElement) void document.exitFullscreen();
						else void node.requestFullscreen();
					}}
				>
					{full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
				</RoundButton>
			</div>
		</div>
	);
}

function AudioStage({path}: {path: string}) {
	const play = usePlayback<HTMLAudioElement>(path);
	if (play.failed) return <Unavailable label="音频无法播放" />;
	return (
		<div className="flex items-center gap-2.5 px-3 py-2">
			<audio {...play.events} ref={play.ref} />
			<RoundButton label={play.playing ? '暂停' : '播放'} onClick={play.toggle}>
				{play.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
			</RoundButton>
			<div className="min-w-0 flex-1">
				<Scrub current={play.current} duration={play.duration} onSeek={play.seek} tone="ink" />
			</div>
			<span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
				{clock(play.current)}/{clock(play.duration)}
			</span>
		</div>
	);
}

function ImageStage({path, alt}: {path: string; alt: string}) {
	const [open, setOpen] = useState(false);
	const src = toProjectMediaUrl(path);
	return (
		<>
			<button
				type="button"
				className="block w-full cursor-zoom-in bg-muted/30 text-left"
				aria-label="放大图片"
				onClick={() => setOpen(true)}
			>
				<ProjectImage src={path} alt={alt} className="my-0 max-h-80 border-0" />
			</button>
			<ImageLightbox src={open ? src : null} alt={alt} onClose={() => setOpen(false)} />
		</>
	);
}

function RoundButton({
	label,
	onClick,
	light,
	children
}: {
	label: string;
	onClick: () => void;
	light?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={cn(
				'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
				light
					? 'bg-white/15 text-white hover:bg-white/25'
					: 'bg-foreground/10 text-foreground hover:bg-foreground/15'
			)}
		>
			{children}
		</button>
	);
}

function Unavailable({label}: {label: string}) {
	return <div className="px-3 py-2 text-[11px] text-muted-foreground">{label}</div>;
}

export function MediaStage({artifact, alt}: {artifact: MediaArtifact; alt: string}) {
	if (artifact.kind === 'image') return <ImageStage path={artifact.path} alt={alt} />;
	if (artifact.kind === 'video') return <VideoStage path={artifact.path} />;
	return <AudioStage path={artifact.path} />;
}
