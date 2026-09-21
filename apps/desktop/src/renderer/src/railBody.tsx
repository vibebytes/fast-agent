import {lazy} from 'react';
import type {GitFileChange} from '@fast-ide/session-view';
import type {CodeChange, ProjectState} from './env';
import type {EditorCursorStatus, MonacoEditorHandle} from './MonacoEditor';
import {BrowserPane} from './panes/BrowserPane';
import {CanvasPane} from './panes/CanvasPane';
import {ChangesPane} from './panes/ChangesPane';
import {ContextPane} from './panes/ContextPane';
import {DocumentPane} from './panes/DocumentPane';
import {FilesPane} from './panes/FilesPane';
import {ReviewDiffPane} from './panes/ReviewDiffPane';
import {TerminalPane} from './panes/TerminalPane';
import type {ReviewRow} from './review/agentReview';
import type {AgentReview} from './review/useAgentReview';
import type {RailTab} from './railTabs';

const ScheduledJobsPane = lazy(() =>
	import('./panes/ScheduledJobsPane').then(m => ({default: m.ScheduledJobsPane}))
);

export function RailTabBody({
	tab,
	changes,
	project,
	onPatch,
	onOpenFile,
	onEditorStatus,
	activeFilePath,
	gitFiles,
	review,
	diffRefresh,
	onOpenDiff,
	onRefreshGit,
	focusSessionId,
	onOpenLivingSession,
	onOpenTeams,
	documentActive,
	onDocumentSave,
	onDocumentBuffer
}: {
	tab: RailTab;
	changes: CodeChange[];
	project: ProjectState | null;
	onPatch: (patch: Partial<RailTab>) => void;
	onOpenFile: (relativePath: string) => void;
	onEditorStatus?: (status: EditorCursorStatus | null) => void;
	activeFilePath?: string | null;
	gitFiles?: GitFileChange[];
	review: AgentReview;
	diffRefresh: number;
	onOpenDiff: (row: ReviewRow) => void;
	onRefreshGit?: () => void;
	focusSessionId?: string | null;
	onOpenLivingSession?: (sessionId: string, projectId?: string) => void;
	onOpenTeams?: (req: {
		tab?: 'teams' | 'agents' | 'goals';
		goalId?: string;
		teamId?: string;
		agentId?: string;
	}) => void;
	documentActive?: boolean;
	onDocumentSave?: (content: string) => void;
	onDocumentBuffer?: (handle: MonacoEditorHandle | null) => void;
}) {
	switch (tab.kind) {
		case 'files':
			return (
				<FilesPane
					project={project}
					onOpenFile={onOpenFile}
					activeFilePath={activeFilePath}
					gitFiles={gitFiles}
					agentReview={review.list}
					onRefreshGit={onRefreshGit}
				/>
			);
		case 'changes':
			return (
				<ChangesPane
					review={review}
					changes={changes}
					projectId={project?.id ?? null}
					onOpenDiff={onOpenDiff}
					onOpenFile={onOpenFile}
				/>
			);
		case 'diff':
			return (
				<ReviewDiffPane
					tab={tab}
					review={review}
					projectId={project?.id ?? null}
					refreshToken={diffRefresh}
				/>
			);
		case 'context':
			return <ContextPane project={project} />;
		case 'browser':
			return <BrowserPane tab={tab} onPatch={onPatch} />;
		case 'document':
			return (
				<DocumentPane
					tab={tab}
					onPatch={onPatch}
					onEditorStatus={onEditorStatus}
					active={documentActive}
					onSave={onDocumentSave}
					bufferRef={onDocumentBuffer}
					review={review}
				/>
			);
		case 'canvas':
			return <CanvasPane />;
		case 'terminal':
			return <TerminalPane title={tab.title} />;
		case 'scheduled':
			return (
				<ScheduledJobsPane
					focusSessionId={focusSessionId}
					onOpenSession={(sessionId, projectId) => {
						if (onOpenLivingSession) onOpenLivingSession(sessionId, projectId);
						else void window.fastIde.selectTask(sessionId);
					}}
					onOpenTeams={onOpenTeams}
				/>
			);
	}
}

