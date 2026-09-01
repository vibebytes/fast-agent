import type {BridgeCommand} from '@fastllm/bridge-protocol';

/** Default Meta project id from Engine bootstrap (`MetaDdl.DefaultProjectId`). */
export const DEFAULT_PROJECT_ID = 'default-project';

/** Slash `/new` | `/reset` | `/clear` → Meta CreateSession (cli-ink Attach path). */
export function createSessionFromSlash(args: string): Extract<BridgeCommand, {type: 'CreateSession'}> {
	const title = args.trim() || undefined;
	return {
		type: 'CreateSession',
		projectId: DEFAULT_PROJECT_ID,
		...(title ? {title} : {})
	};
}
