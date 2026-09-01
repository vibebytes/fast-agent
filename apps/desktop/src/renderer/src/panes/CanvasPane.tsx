export function CanvasPane() {
	return (
		<div className="relative h-full min-h-0 bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:16px_16px]">
			<div className="absolute inset-0 flex items-center justify-center">
				<p className="rounded-md border bg-background/90 px-3 py-2 text-sm text-muted-foreground shadow-sm">
					Canvas placeholder — draw / board tools coming later
				</p>
			</div>
		</div>
	);
}
