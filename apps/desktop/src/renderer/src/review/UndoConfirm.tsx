import {useContext, useMemo, useState} from 'react';
import type {ReviewPreview} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {Checkbox} from '@fast-ide/ui/components/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {ScrollArea} from '@fast-ide/ui/components/scroll-area';
import {cn} from '@fast-ide/ui/lib/utils';
import {dirtyOverlap} from './agentReview';
import {ReviewDirtyPaths} from './useKeepFlow';

/**
 * The second half of a two-phase undo: what the plan will do, before anything is written.
 *
 * It exists because the three path lists on a preview mean different things and only one of them is
 * routine. A file the user edited after the agent did needs saying so; a file that was never captured
 * cannot be put back at all; and a conflicted file is only overwritten after the user ticks that path
 * by name — one blanket "force" checkbox would let a mis-click discard work the agent never touched.
 */
/**
 * The two halves of "go back to this moment", as the timeline entry offers them.
 *
 * Both sides are shown even when one cannot be ticked: a user who came here to rewind the conversation
 * has to learn that only the files are going back, and a dialog that quietly omitted the option would
 * let them believe the messages went with them.
 */
export type RestoreScope = {
	files: boolean;
	conversation: boolean;
	/** Why the conversation side is not on offer, when it is not. */
	conversationBlocked?: string;
	onFiles: (on: boolean) => void;
	onConversation: (on: boolean) => void;
};

export function UndoConfirm({
	preview,
	busy,
	scope,
	onCancel,
	onConfirm
}: {
	preview: ReviewPreview;
	busy: boolean;
	/** Present for the timeline entry, absent for the drawer's file-only undo. */
	scope?: RestoreScope;
	onCancel: () => void;
	onConfirm: (force: boolean) => void;
}) {
	const [forced, setForced] = useState<Set<string>>(new Set());
	const dirtyPaths = useContext(ReviewDirtyPaths);
	const forcePaths = preview.forcePaths;
	const merged = new Set(preview.mergedPaths);
	const shells = preview.activeShells ?? [];
	const unsaved = useMemo(
		() => dirtyOverlap(dirtyPaths, preview.changes.map(c => c.path)),
		[dirtyPaths, preview.changes]
	);
	// Every conflicted path must be ticked by name, so a plan cannot be forced through wholesale.
	// A scoped restore also needs at least one side ticked, or it would do nothing at all.
	const ready =
		forcePaths.every(path => forced.has(path)) && (!scope || scope.files || scope.conversation);

	const reasons = useMemo(
		() => new Map(preview.conflicts.map(conflict => [conflict.path, conflict.reason])),
		[preview.conflicts]
	);

	const toggle = (path: string) =>
		setForced(prev => {
			const next = new Set(prev);
			if (!next.delete(path)) next.add(path);
			return next;
		});

	return (
		<Dialog open onOpenChange={open => !open && onCancel()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{scope
							? 'Restore to this message?'
							: `Undo ${preview.changes.length} file${preview.changes.length === 1 ? '' : 's'}?`}
					</DialogTitle>
					<DialogDescription>
						The agent's edits are put back the way they were. Your own later edits are kept
						wherever they can be.
					</DialogDescription>
				</DialogHeader>

				{scope ? (
					<div className="space-y-2 rounded-md border p-2 text-xs">
						<div className="flex items-start gap-2">
							<Checkbox
								id="scope-files"
								checked={scope.files}
								onCheckedChange={on => scope.onFiles(on === true)}
								disabled={busy}
							/>
							<label htmlFor="scope-files" className="min-w-0 flex-1">
								<span className="block font-medium">Files</span>
								<span className="block text-muted-foreground">
									{preview.changes.length} path
									{preview.changes.length === 1 ? '' : 's'} go back to the state before
									this message.
								</span>
							</label>
						</div>
						<div className="flex items-start gap-2">
							<Checkbox
								id="scope-conversation"
								checked={scope.conversation}
								onCheckedChange={on => scope.onConversation(on === true)}
								disabled={busy || Boolean(scope.conversationBlocked)}
							/>
							<label htmlFor="scope-conversation" className="min-w-0 flex-1">
								<span className="block font-medium">Conversation</span>
								<span className="block text-muted-foreground">
									{scope.conversationBlocked ??
										'Messages after this one are hidden, and sending a new one drops them.'}
								</span>
							</label>
						</div>
					</div>
				) : null}

				<ScrollArea className="max-h-64">
					<ul className="space-y-1 pr-2 text-xs">
						{preview.changes.map(change => (
							<li key={change.path} className="flex items-center gap-2">
								<span className="w-14 shrink-0 text-muted-foreground">{change.kind}</span>
								<span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
								{merged.has(change.path) ? (
									<span className="shrink-0 text-amber-600 dark:text-amber-400">
										merged with your edits
									</span>
								) : null}
							</li>
						))}
					</ul>

					{preview.excludedPaths.length > 0 ? (
						<div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
							<p className="font-medium">Not covered by this undo</p>
							{/* Never captured, so there is nothing to put back — saying it here beats letting
							    the user find out from the file. */}
							<p className="mt-0.5 text-muted-foreground">
								These paths were excluded when the change was recorded and cannot be
								restored:
							</p>
							<ul className="mt-1 space-y-0.5 font-mono">
								{preview.excludedPaths.map(path => (
									<li key={path} className="truncate">
										{path}
									</li>
								))}
							</ul>
						</div>
					) : null}

					{shells.length > 0 ? (
						<div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
							<p className="font-medium">
								{shells.length} command{shells.length === 1 ? '' : 's'} still running here
							</p>
							{/* A dev server or build reading the tree mid-restore is the user's call to make,
							    not ours to refuse — but they cannot make it if we stay quiet. */}
							<p className="mt-0.5 text-muted-foreground">
								Undoing rewrites files underneath them, so they may reload half-old sources
								or fail:
							</p>
							<ul className="mt-1 space-y-0.5 font-mono">
								{shells.map(command => (
									<li key={command} className="truncate">
										{command}
									</li>
								))}
							</ul>
						</div>
					) : null}

					{unsaved.length > 0 ? (
						<div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
							<p className="font-medium">Unsaved editor text will be lost</p>
							<p className="mt-0.5 text-muted-foreground">
								Undo writes these files on disk and reloads open tabs, so the buffer is
								discarded:
							</p>
							<ul className="mt-1 space-y-0.5 font-mono">
								{unsaved.map(path => (
									<li key={path} className="truncate">
										{path}
									</li>
								))}
							</ul>
						</div>
					) : null}

					{forcePaths.length > 0 ? (
						<div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
							<p className="font-medium">Overwrite these to continue</p>
							<p className="mt-0.5 text-muted-foreground">
								Each of these changed after the agent wrote it, so undoing loses that
								change. Tick the ones you agree to overwrite.
							</p>
							<ul className="mt-1.5 space-y-1.5">
								{forcePaths.map(path => (
									<li key={path} className="flex items-start gap-2">
										<Checkbox
											id={`force-${path}`}
											checked={forced.has(path)}
											onCheckedChange={() => toggle(path)}
											disabled={busy}
										/>
										<label htmlFor={`force-${path}`} className="min-w-0 flex-1">
											<span className="block truncate font-mono">{path}</span>
											{reasons.get(path) ? (
												<span className="block text-muted-foreground">
													{reasons.get(path)}
												</span>
											) : null}
										</label>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</ScrollArea>

				<DialogFooter>
					<Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
						Cancel
					</Button>
					<Button
						type="button"
						size="sm"
						variant={forcePaths.length > 0 ? 'destructive' : 'default'}
						className={cn(!ready && 'pointer-events-none opacity-50')}
						disabled={busy || !ready}
						onClick={() => onConfirm(forcePaths.length > 0)}
					>
						{forcePaths.length > 0
							? `Overwrite ${forcePaths.length} and ${scope ? 'restore' : 'undo'}`
							: scope
								? 'Restore'
								: 'Undo'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
