/**
 * Cold-start landing — full-viewport brand + status until workspace:restored/failed.
 * Minimal content, deliberate motion and atmosphere (no progress steps / logs).
 */
import {cn} from '@fast-ide/ui/lib/utils';

export function Landing({className}: {className?: string}) {
	return (
		<div
			className={cn(
				'relative flex h-svh w-full flex-col items-center justify-center overflow-hidden',
				'bg-[radial-gradient(120%_80%_at_50%_-10%,hsl(var(--primary)/0.14),transparent_55%),hsl(var(--background))]',
				className
			)}
			role="status"
			aria-live="polite"
			aria-label="Starting Fast"
		>
			<style>{`
				@keyframes landing-rise {
					from { opacity: 0; transform: translateY(10px); }
					to { opacity: 1; transform: translateY(0); }
				}
				@keyframes landing-spin {
					to { transform: rotate(360deg); }
				}
			`}</style>

			{/* Drag region for frameless window chrome */}
			<div className="app-region-drag absolute inset-x-0 top-0 h-10" aria-hidden />

			<div className="relative z-10 flex flex-col items-center gap-8 px-6">
				<div
					className="flex flex-col items-center gap-3 text-center"
					style={{animation: 'landing-rise 0.7s ease-out both'}}
				>
					<p className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
						Fast
					</p>
					<p
						className="text-sm text-muted-foreground"
						style={{animation: 'landing-rise 0.7s ease-out 0.12s both'}}
					>
						Starting engine…
					</p>
				</div>

				<div
					className="relative size-10"
					style={{animation: 'landing-rise 0.7s ease-out 0.24s both'}}
					aria-hidden
				>
					<span className="absolute inset-0 rounded-full border border-primary/25" />
					<span
						className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary/80"
						style={{animation: 'landing-spin 1.1s linear infinite'}}
					/>
				</div>
			</div>

			<div
				className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-foreground/[0.03] to-transparent"
				aria-hidden
			/>
		</div>
	);
}
