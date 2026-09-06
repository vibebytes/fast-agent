import {z} from 'zod';

export const reviewSide = z
	.object({
		id: z.string(),
		text: z.string().optional(),
		bytes: z.number().optional(),
		/**
		 * Why `text` is absent: not text, too large to send inline, or no longer in the store — in
		 * which case this path cannot be restored either, and the UI must say so rather than keep
		 * offering a diff.
		 */
		omitted: z.enum(['binary', 'too-large', 'missing']).optional()
	})
	.nullish();

export const reviewChange = z.object({
	id: z.string(),
	checkpointId: z.string(),
	path: z.string(),
	kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
	state: z
		.object({
			kind: z.enum(['pending', 'reverted', 'kept', 'conflict']),
			fingerprint: z.string().optional(),
			reason: z.string().optional()
		})
		.passthrough(),
	/** Rename group: both paths are always kept or undone together. */
	groupId: z.string().nullish(),
	before: reviewSide,
	after: reviewSide,
	current: reviewSide
});

export const fileReviewDiff = z.object({
	path: z.string(),
	changeIds: z.array(z.string()),
	hunks: z.array(
		z.object({
			oldStart: z.number(),
			oldLines: z.number(),
			newStart: z.number(),
			newLines: z.number(),
			lines: z.array(
				z.object({
					kind: z.enum(['context', 'add', 'del']),
					oldLine: z.number().nullish(),
					newLine: z.number().nullish(),
					text: z.string()
				})
			)
		})
	),
	additions: z.number(),
	deletions: z.number(),
	afterBlobId: z.string().nullish(),
	broken: z.boolean().optional(),
	blocked: z.string().nullish()
});

export const reviewPayload = z.object({
	/** The workspace revision this answer was computed against. */
	revision: z.number().optional(),
	changes: z.array(reviewChange).optional(),
	/** Batched per-path hunks of the pending agent effect (ListReviewDiff). */
	diff: z
		.object({
			revision: z.number(),
			files: z.array(fileReviewDiff),
			removedPaths: z.array(z.string()).optional(),
			partial: z.boolean().optional()
		})
		.optional(),
	/** One path's net effect (GetFileReviewDiff). */
	file: fileReviewDiff.nullish(),
	/**
	 * Where each checkpoint sits in the conversation, so a timeline row can offer a restore. `runId` is
	 * the anchor a transcript can match; `messageId` is the engine's own row id.
	 */
	checkpoints: z
		.array(
			z.object({
				id: z.string(),
				runId: z.string(),
				messageId: z.string().nullish(),
				at: z.number()
			})
		)
		.optional(),
	change: reviewChange.nullish(),
	preview: z
		.object({
			id: z.string(),
			target: z
				.object({
					kind: z.enum(['timeline', 'whole', 'pending', 'changes']),
					checkpointId: z.string().nullish(),
					changeIds: z.array(z.string()).optional()
				})
				.passthrough(),
			revision: z.number(),
			changes: z.array(
				z.object({
					path: z.string(),
					kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
					previousPath: z.string().nullish()
				})
			),
			conflicts: z.array(z.object({path: z.string(), reason: z.string()})),
			/** Captured-but-excluded paths that cannot be restored at all. */
			excludedPaths: z.array(z.string()),
			/** Conflicted paths a forced apply would overwrite. */
			forcePaths: z.array(z.string()),
			/** Paths whose result folds in edits made after the agent's. */
			mergedPaths: z.array(z.string()),
			/**
			 * Background commands still running in this workspace. Restoring writes files underneath
			 * them, so the user has to be told before confirming — it does not block the restore.
			 */
			activeShells: z.array(z.string()).optional()
		})
		.optional(),
	restored: z
		.object({
			restoreId: z.string(),
			fromTree: z.string(),
			toTree: z.string(),
			revision: z.number()
		})
		.optional(),
	conflicts: z.array(z.object({path: z.string(), reason: z.string()})).optional(),
	movedPaths: z.array(z.string()).optional(),
	/** False when checkpoints are off: the UI must say changes cannot be undone. */
	available: z.boolean().optional(),
	/**
	 * The snapshot this restore needed is gone. Retrying cannot help, so a client must stop offering
	 * the restore point rather than report a transient failure.
	 */
	expired: z.boolean().optional(),
	missingRefs: z.array(z.string()).optional(),
	backend: z.string().optional()
});

export type CheckoutCommand =
	{
			type: 'ListRules';
			scope?: 'global' | 'project' | string;
			projectId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'AddRule';
			scope: 'global' | 'project' | string;
			text: string;
			projectId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'RemoveRule'; id: string; tenantId?: string; appId?: string}
	| {
			type: 'SetRuleEnabled';
			id: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	/**
	 * Agent change review for one checkout. The workspace is named by `workspaceId` (path hash or Meta
	 * id) or by the session bound to it; paths are never part of a payload, so a client cannot ask the
	 * daemon to write outside the checkout.
	 */
	| {
			type: 'ListReviewChanges';
			workspaceId?: string;
			sessionId?: string;
			checkpointId?: string;
			tenantId?: string;
	  }
	| {
			type: 'GetReviewChange';
			changeId: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/**
	 * The whole pending agent effect in one answer: per path, hunks of first.before → last.after.
	 * One round trip replaces the per-row detail storm.
	 */
	| {
			type: 'ListReviewDiff';
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
			/** Revision the client already holds; omitted = full snapshot. */
			sinceRevision?: number;
	  }
	/**
	 * One path's net effect with the batch hunk-line cap lifted. The path selects among this
	 * checkout's undecided review rows — it is not a workspace read of an arbitrary file.
	 */
	| {
			type: 'GetFileReviewDiff';
			path: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** `revision` is the list the user decided against; a moved list is rejected as stale. */
	| {
			type: 'KeepChanges';
			changeIds: string[];
			revision: number;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Plans an undo without touching a file. `timeline`/`whole` need `checkpointId`, `changes` needs `changeIds`. */
	| {
			type: 'PreviewRevert';
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Writes the plan. `force` overwrites the paths the preview listed in `forcePaths`. */
	| {
			type: 'ApplyRevert';
			previewId: string;
			force?: boolean;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	| {
			type: 'RedoRevert';
			restoreId: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Host-level editor FS: list one directory under a registered slot. */
	| {
			type: 'ListWorkspaceDir';
			requestId: string;
			workspaceId: string;
			relativePath?: string;
			tenantId?: string;
	  }
	/** Browse daemon disk outside a registered slot (remote open-folder). */
	| {
			type: 'ListHostDir';
			requestId: string;
			path?: string;
	  }
	/** Create one directory on daemon disk (remote open-folder). `name` is a single segment. */
	| {
			type: 'CreateHostDir';
			requestId: string;
			parent: string;
			name: string;
	  }
	/** Host-level editor FS: read a text file (≤2MB). */
	| {
			type: 'GetWorkspaceFile';
			requestId: string;
			workspaceId: string;
			relativePath: string;
			tenantId?: string;
	  }
	/** Host-level editor FS: save with optional mtime (+ bytes) CAS. */
	| {
			type: 'SaveWorkspaceFile';
			requestId: string;
			workspaceId: string;
			relativePath: string;
			content: string;
			mtime?: number;
			bytes?: number;
			tenantId?: string;
	  }
	/** Host-level SCM chrome: branch + dirty files under a registered slot. */
	| {
			type: 'GitWorkspaceStatus';
			requestId: string;
			workspaceId: string;
			tenantId?: string;
	  }

export const checkoutCommandSchemas = [
	z.object({
		type: z.literal('ListRules'),
		scope: z.string().optional(),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('AddRule'),
		scope: z.string(),
		text: z.string(),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('RemoveRule'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetRuleEnabled'),
		id: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListReviewChanges'),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		checkpointId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('GetReviewChange'),
		changeId: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListReviewDiff'),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional(),
		sinceRevision: z.number().optional()
	}),
	z.object({
		type: z.literal('GetFileReviewDiff'),
		path: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('KeepChanges'),
		changeIds: z.array(z.string()),
		revision: z.number(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('PreviewRevert'),
		target: z.enum(['timeline', 'whole', 'pending', 'changes']),
		revision: z.number(),
		checkpointId: z.string().optional(),
		changeIds: z.array(z.string()).optional(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ApplyRevert'),
		previewId: z.string(),
		force: z.boolean().optional(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('RedoRevert'),
		restoreId: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListWorkspaceDir'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListHostDir'),
		requestId: z.string(),
		path: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateHostDir'),
		requestId: z.string(),
		parent: z.string(),
		name: z.string()
	}),
	z.object({
		type: z.literal('GetWorkspaceFile'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('SaveWorkspaceFile'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string(),
		content: z.string(),
		mtime: z.number().optional(),
		/** Size paired with mtime for coarse-FS CAS. */
		bytes: z.number().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('GitWorkspaceStatus'),
		requestId: z.string(),
		workspaceId: z.string(),
		tenantId: z.string().optional()
	})
] as const

export const checkoutEventSchemas = [
	/**
	 * The workspace tree moved (an agent batch, or a restore). Refresh the review drawer, the file-tree
	 * overlay and any open diff; the two trees name what to ask about instead of rescanning.
	 */
	z.object({
		type: z.literal('tree_advanced'),
		pathHash: z.string(),
		fromTree: z.string(),
		toTree: z.string(),
		cause: z.enum(['mutation', 'restore']),
		checkpointId: z.string().optional(),
		restoreId: z.string().optional()
	}),
	/** The review projection moved. `revision` does not change on a keep, so always re-read the list. */
	z.object({type: z.literal('review_changed'), pathHash: z.string(), revision: z.number()}),
	/** Slot working-copy file changed (editor Save / agent / host watcher). */
	z.object({
		type: z.literal('workspace_file_changed'),
		pathHash: z.string(),
		relativePath: z.string(),
		mtime: z.number(),
		origin: z.enum(['client', 'agent', 'watch']),
		connectionId: z.string().optional()
	})
] as const
