import {useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {CircleAlert, Info} from 'lucide-react';

const IntroKey = 'fast-ide.checkpointIntroSeen';

/**
 * What the user has to know about checkpoints, said once each way round.
 *
 * With them off the line stays up for as long as they are off: an agent editing files with no way back
 * is the kind of thing a user must not have to remember on their own. With them on it is said once and
 * dismissed, including what the protection costs — a snapshot scans the work tree, and a user who
 * discovers that from a slow batch instead of from us will assume something is broken.
 */
export function CheckpointNotice({available}: {available: boolean}) {
	const [seen, setSeen] = useState(() => {
		try {
			return window.localStorage.getItem(IntroKey) === 'yes';
		} catch (e) {
			// Private mode or a locked-down profile: showing the hint again is the harmless side.
			console.warn('[checkpoint] could not read the intro flag', e);
			return false;
		}
	});

	if (!available) {
		return (
			<div className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-3 py-2 text-[11px]">
				<CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
				<p className="text-muted-foreground">
					<span className="font-medium text-foreground">
						Agent changes cannot be restored automatically.
					</span>{' '}
					Workspace checkpoints are off for this project, so nothing here can be undone for you
					— use your own version control before letting the agent edit files.
				</p>
			</div>
		);
	}

	if (seen) return null;

	const dismiss = () => {
		setSeen(true);
		try {
			window.localStorage.setItem(IntroKey, 'yes');
		} catch (e) {
			console.warn('[checkpoint] could not store the intro flag', e);
		}
	};

	return (
		<div className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-[11px]">
			<Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1 text-muted-foreground">
				<p>
					<span className="font-medium text-foreground">
						Agent edits are snapshotted before each batch,
					</span>{' '}
					so you can undo them here file by file, or rewind the workspace to any message.
				</p>
				<p className="mt-0.5">
					Each snapshot scans the project: milliseconds on a normal tree, a second or two on a
					very large one.
				</p>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className="h-5 shrink-0 px-1.5 text-[11px]"
				onClick={dismiss}
			>
				Got it
			</Button>
		</div>
	);
}
