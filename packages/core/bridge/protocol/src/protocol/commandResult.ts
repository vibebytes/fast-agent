import {z} from 'zod';
import {reviewPayload} from './checkout.js';

export const commandResultSchema = z.object({
		type: z.literal('command_result'),
		name: z.string(),
		message: z.string(),
		/** Engine RouteResult.status + classic ACK statuses; keep in sync with SessionEntity routes (Follow-up `queued`, DSH busy insert `steered`). */
		status: z.enum(['success', 'unavailable', 'error', 'decided', 'answered', 'accepted', 'rejected', 'cancelled', 'paused', 'resumed', 'triggered', 'queued', 'steered']).optional(),
		capability: z.string().optional(),
		availability: z.enum(['ready', 'partial', 'capability_unavailable', 'hidden']).optional(),
		sessionId: z.string().optional(),
		workspaceId: z.string().optional(),
		projectId: z.string().optional(),
		/** Slot path hash (12-hex = 6 bytes); distinct from Meta workspace resource id in workspaceId. */
		pathHash: z.string().optional(),
		/** Parallel FS command correlation (List/Get/SaveWorkspaceFile). */
		requestId: z.string().optional(),
		/** Editor workspace FS payload. */
		fs: z
			.object({
				code: z
					.enum([
						'outside',
						'exists',
						'too-large',
						'binary',
						'conflict',
						'missing',
						'no-slot',
						'busy',
						'is-dir',
						'not-found',
						'not-dir',
						'denied',
						'invalid'
					])
					.optional(),
				relativePath: z.string().optional(),
				content: z.string().optional(),
				mtime: z.number().optional(),
				bytes: z.number().optional(),
				entries: z
					.array(
						z.object({
							name: z.string(),
							relativePath: z.string().optional(),
							path: z.string().optional(),
							kind: z.enum(['file', 'dir']),
							mtime: z.number().optional().nullable()
						})
					)
					.optional(),
				truncated: z.boolean().optional(),
				path: z.string().optional(),
				home: z.string().optional(),
				name: z.string().optional()
			})
			.optional(),
		/** SCM chrome payload (GitWorkspaceStatus). Optional so other command_result events still parse. */
		git: z
			.object({
				available: z.boolean(),
				branch: z.string().optional(),
				dirty: z.boolean().optional(),
				files: z
					.array(
						z.object({
							path: z.string(),
							kind: z.enum(['modified', 'added', 'deleted'])
						})
					)
					.optional()
			})
			.optional(),
		/** Structured Session display title (SetSessionTitle / auto-title). */
		title: z.string().optional(),
		/** Structured Project display name (SetProjectDisplayName). */
		displayName: z.string().optional(),
		/** CreateSession / NewSession correlation: local optimistic Task id (passthrough). */
		taskId: z.string().optional(),
		/** Default subject agent minted by Meta CreateSession (`session.owner_agent_id`). */
		ownerAgentId: z.string().optional(),
		/** Settings-center documents (GetSettings / PatchSettings). */
		settings: z
			.array(
				z.object({
					scope: z.string(),
					scopeId: z.string(),
					namespace: z.string(),
					payload: z.unknown(),
					schemaVersion: z.number(),
					updatedAt: z.string().nullish(),
					/** Only on scope=effective reads: global | project | merged. */
					source: z.string().nullish()
				})
			)
			.optional(),
		/** Model providers (List/Upsert/…Provider) — never includes ciphertext. */
		providers: z
			.array(
				z.object({
					id: z.string(),
					kind: z.string(),
					vendor: z.string(),
					name: z.string(),
					baseUrl: z.string().nullish(),
					status: z.string().nullish(),
					statusDetail: z.string().nullish(),
					last4: z.string().nullish(),
					modelCount: z.number(),
					enabledModelCount: z.number(),
					enabled: z.boolean(),
					meta: z.unknown().optional(),
					models: z.array(z.unknown()).optional(),
					updatedAt: z.string().nullish()
				})
			)
			.optional(),
		/** OpenRouter search candidates (SearchProviderModels). */
		searchModels: z
			.array(
				z.object({
					modelId: z.string(),
					displayName: z.string(),
					contextLength: z.number().nullish(),
					vendorHint: z.string().nullish()
				})
			)
			.optional(),
		/** Installed skills (List/Create/SetSkillEnabled). */
		skills: z
			.array(
				z.object({
					name: z.string(),
					description: z.string(),
					scope: z.string(),
					source: z.string(),
					marketId: z.string().nullish(),
					enabled: z.boolean(),
					location: z.string().nullish(),
					dirName: z.string().nullish()
				})
			)
			.optional(),
		/** Extension admin rows (ListExtensions / ExtensionStatus). */
		extensions: z
			.array(
				z.object({
					id: z.string(),
					phase: z.enum(['Installed', 'Active', 'Stopping', 'Uninstalled', 'Failed']),
					hotUnload: z.boolean(),
					fault: z.string().optional(),
					restartHint: z.string().optional()
				})
			)
			.optional(),
		/** L0 engine admin rows (ListEngines / write cmds). */
		engines: z
			.array(
				z.object({
					id: z.string(),
					kind: z.enum(['builtin', 'extension']),
					adapter: z.enum(['ready', 'disabled', 'failed']),
					program: z.enum(['builtin', 'installed', 'missing', 'installing']),
					process: z.enum(['none', 'stopped', 'running']),
					processDetail: z.string().regex(/^[^:]+:\d+$/).optional(),
					isDefault: z.boolean(),
					inRegistry: z.boolean(),
					actions: z.array(z.string()),
					installLog: z
						.array(
							z.object({
								stream: z.enum(['stdout', 'stderr']),
								text: z.string(),
								seq: z.number()
							})
						)
						.optional()
				})
			)
			.optional(),
		/** Local Ledger marks (put/drop) on ListExtensions. */
		ledger: z
			.array(
				z.object({
					id: z.string(),
					mark: z.string()
				})
			)
			.optional(),
		/** Skills.sh market search rows (SearchSkillMarket). */
		marketSkills: z
			.array(
				z.object({
					id: z.string(),
					skillId: z.string(),
					name: z.string(),
					source: z.string(),
					installs: z.number(),
					isInstalled: z.boolean()
				})
			)
			.optional(),
		/** Ambient Rules payload (ListRules / AddRule). */
		rules: z
			.array(
				z.object({
					id: z.string(),
					scope: z.string(),
					projectId: z.string().nullish(),
					text: z.string(),
					enabled: z.boolean(),
					createdAt: z.string().nullish()
				})
			)
			.optional(),
		/** Platform / loop ScheduledJob rows (ListScheduledJobs). */
		scheduledJobs: z
			.array(
				z.object({
					id: z.string(),
					kind: z.string(),
					status: z.string(),
					sessionId: z.string(),
					projectId: z.string().nullish(),
					cronExpr: z.string().nullish(),
					timezone: z.string().nullish(),
					nextFireAt: z.string().nullish(),
					title: z.string().nullish(),
					promptText: z.string().nullish(),
					targetKind: z.string().nullish(),
					targetRef: z.string().nullish()
				})
			)
			.optional(),
		/** ScheduledJobRun history (ListScheduledJobRuns). */
		scheduledJobRuns: z
			.array(
				z.object({
					id: z.string(),
					jobId: z.string(),
					sessionId: z.string(),
					status: z.string(),
					startedAt: z.string().nullish(),
					finishedAt: z.string().nullish(),
					summary: z.string().nullish(),
					error: z.string().nullish(),
					runId: z.string().nullish()
				})
			)
			.optional(),
		/** Cross-project LivingTask tree (ListLivingTasks). */
		livingTasks: z
			.array(
				z.object({
					projectId: z.string(),
					displayName: z.string().optional(),
					sessions: z.array(z.unknown()).optional()
				}).passthrough()
			)
			.optional(),
		/** Teams UI — ListTeams. */
		teams: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					kind: z.string(),
					status: z.string(),
					projectId: z.string(),
					workspaceId: z.string().nullish(),
					originGoalId: z.string().nullish(),
					verifierAgentId: z.string().nullish(),
					defaultWorkflowSpec: z.string().nullish(),
					description: z.string().nullish(),
					members: z
						.array(
							z.object({
								name: z.string(),
								teamRole: z.string(),
								agentId: z.string()
							})
						)
						.optional()
				})
			)
			.optional(),
		/** Teams UI — ListGoals. */
		goals: z
			.array(
				z.object({
					id: z.string(),
					status: z.string(),
					name: z.string().nullish(),
					statement: z.string().nullish(),
					acceptance: z.string().nullish(),
					originSessionId: z.string().nullish(),
					controlSessionId: z.string().nullish(),
					teamId: z.string().nullish(),
					projectId: z.string().nullish(),
					currentStepIds: z.array(z.string()).nullish(),
					activeRunIds: z.array(z.string()).nullish(),
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId: z.union([z.string(), z.array(z.string())]).nullish(),
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId: z.union([z.string(), z.array(z.string())]).nullish(),
					confirmedAt: z.string().nullish(),
					resultSummary: z.string().nullish(),
					escalateActions: z.array(z.string()).optional(),
					workflowJson: z.string().nullish(),
					budgetJson: z.string().nullish(),
					progressJson: z.string().nullish(),
					membersJson: z.string().nullish(),
					loopAgentId: z.string().nullish()
				})
			)
			.optional(),
		/** Teams UI — ListAgents. */
		agents: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					status: z.string(),
					projectId: z.string(),
					teamId: z.string().nullish(),
					teamRole: z.string().nullish(),
					model: z.string().nullish(),
					taskBrief: z.string().nullish(),
					declarationJson: z.string().nullish(),
					latestRunId: z.string().nullish()
				})
			)
			.optional(),
		/** Goal snapshot on Goal host command results (ConfirmGoal / PatchGoal / GoalStatus) — ②′ card refresh. */
		goal: z
			.object({
				id: z.string(),
				status: z.string(),
				name: z.string().nullish(),
				statement: z.string().nullish(),
				acceptance: z.string().nullish(),
				originSessionId: z.string().nullish(),
				controlSessionId: z.string().nullish(),
				teamId: z.string().nullish(),
				projectId: z.string().nullish(),
				currentStepIds: z.array(z.string()).nullish(),
				activeRunIds: z.array(z.string()).nullish(),
				/** @deprecated wire dual-read — prefer currentStepIds */
				currentStepId: z.union([z.string(), z.array(z.string())]).nullish(),
				/** @deprecated wire dual-read — prefer activeRunIds */
				activeRunId: z.union([z.string(), z.array(z.string())]).nullish(),
				confirmedAt: z.string().nullish(),
				resultSummary: z.string().nullish(),
				escalateActions: z.array(z.string()).optional(),
				workflowJson: z.string().nullish(),
				budgetJson: z.string().nullish(),
				progressJson: z.string().nullish(),
				membersJson: z.string().nullish(),
				loopAgentId: z.string().nullish()
			})
			.optional(),
		/** Teams UI — CreateTeam / UpdateTeam / GetTeam / Archive*. */
		team: z
			.object({
				id: z.string(),
				name: z.string(),
				kind: z.string(),
				status: z.string(),
				projectId: z.string(),
				workspaceId: z.string().nullish(),
				originGoalId: z.string().nullish(),
				verifierAgentId: z.string().nullish(),
				defaultWorkflowSpec: z.string().nullish(),
				description: z.string().nullish(),
				members: z
					.array(
						z.object({
							name: z.string(),
							teamRole: z.string(),
							agentId: z.string()
						})
					)
					.optional()
			})
			.optional(),
		/** Teams UI — CreateAgent / UpdateAgent / GetAgent / CloneAgent / Archive* / Delete*. */
		agent: z
			.object({
				id: z.string(),
				name: z.string(),
				status: z.string(),
				projectId: z.string(),
				teamId: z.string().nullish(),
				teamRole: z.string().nullish(),
				model: z.string().nullish(),
				taskBrief: z.string().nullish(),
				declarationJson: z.string().nullish(),
				latestRunId: z.string().nullish()
			})
			.optional(),
		/**
		 * Agent change review payload (ListReviewChanges / GetReviewChange / KeepChanges /
		 * PreviewRevert / ApplyRevert / RedoRevert). Which keys are present follows `name` and
		 * `status`: a refusal carries `revision`, `conflicts` or `movedPaths` so the client can resync,
		 * force, or ask for a new preview.
		 */
		review: reviewPayload.optional(),
		/** DshCall method (session.models / settings.describe / …). */
		method: z.string().optional(),
		/** DshCall success — DSH result.value as-is. */
		value: z.unknown().optional(),
		/** DshCall failure — DSH `{ code, message, ... }` as-is. */
		error: z
			.object({
				code: z.string(),
				message: z.string().optional()
			})
			.passthrough()
			.optional(),
		pairing: z
			.object({
				available: z.boolean(),
				reason: z.enum(['no_wss', 'loopback_only', 'off']).optional(),
				host: z.string().optional(),
				port: z.number().optional(),
				serverUrl: z.string().optional(),
				token: z.string().optional(),
				fingerprint: z.string().optional(),
				pairUri: z.string().optional()
			})
			.optional()
	});
