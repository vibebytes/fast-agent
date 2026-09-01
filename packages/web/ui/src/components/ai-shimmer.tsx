import type {MotionProps} from 'motion/react';
import {motion} from 'motion/react';
import {
	memo,
	useMemo,
	type CSSProperties,
	type ComponentType,
	type ElementType,
	type JSX
} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';

type MotionHtmlProps = MotionProps & Record<string, unknown>;

const motionCache = new Map<
	keyof JSX.IntrinsicElements,
	ComponentType<MotionHtmlProps>
>();

function motionOf(element: keyof JSX.IntrinsicElements): ComponentType<MotionHtmlProps> {
	const hit = motionCache.get(element);
	if (hit) return hit;
	const created = motion.create(element);
	motionCache.set(element, created);
	return created;
}

export type TextShimmerProps = {
	/** String only — spread width is derived from character length. */
	children: string;
	as?: ElementType;
	className?: string;
	/** Seconds for one full sweep. */
	duration?: number;
	/** Multiplier × text length → highlight width in px. */
	spread?: number;
};

/**
 * shadcn.io AI Shimmer — motion-driven gradient sweep for live/streaming labels.
 * @see https://www.shadcn.io/ai/shimmer
 */
function TextShimmerComponent({
	children,
	as: Component = 'span',
	className,
	duration = 2,
	spread = 2
}: TextShimmerProps) {
	const MotionComponent = motionOf(Component as keyof JSX.IntrinsicElements);
	const dynamicSpread = useMemo(
		() => Math.max(24, children.length * spread),
		[children, spread]
	);

	return (
		<MotionComponent
			className={cn(
				'relative inline-block max-w-full truncate bg-[length:250%_100%,auto] bg-clip-text text-transparent',
				'[background-repeat:no-repeat,padding-box]',
				// Base = muted; highlight = foreground (visible on light + dark paper).
				'[--shimmer-base:var(--color-muted-foreground)] [--shimmer-highlight:var(--color-foreground)]',
				'[--shimmer-bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--shimmer-highlight),#0000_calc(50%+var(--spread)))]',
				className
			)}
			initial={{backgroundPosition: '100% center'}}
			animate={{backgroundPosition: '0% center'}}
			transition={{
				duration,
				ease: 'linear',
				repeat: Number.POSITIVE_INFINITY
			}}
			style={
				{
					'--spread': `${dynamicSpread}px`,
					WebkitBackgroundClip: 'text',
					WebkitTextFillColor: 'transparent',
					backgroundImage:
						'var(--shimmer-bg), linear-gradient(var(--shimmer-base), var(--shimmer-base))'
				} as CSSProperties
			}
		>
			{children}
		</MotionComponent>
	);
}

export const TextShimmer = memo(TextShimmerComponent);
