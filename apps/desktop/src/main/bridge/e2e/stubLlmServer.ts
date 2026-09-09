/**
 * OpenAI-compatible chat-completions stub for the engine E2E.
 * Serves scripted turns as SSE and records every request body, so the test can
 * prove the real provider stack (catalog lookup, message encode, auth) ran.
 */
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

export type StubTurn = {
	text?: string;
	reasoning?: string;
	inputTokens?: number;
	outputTokens?: number;
};

export type StubLlm = {
	baseUrl: string;
	requests: Array<Record<string, unknown>>;
	close: () => Promise<void>;
};

const sse = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
	sse({
		id: 'chatcmpl-stub',
		object: 'chat.completion.chunk',
		model: 'stub-model',
		choices: [{index: 0, delta, finish_reason: finish}]
	});

export async function startStubLlm(turns: StubTurn[]): Promise<StubLlm> {
	const requests: Array<Record<string, unknown>> = [];
	let served = 0;
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', piece => (body += piece));
		req.on('end', () => {
			if (body) requests.push(JSON.parse(body) as Record<string, unknown>);
			const turn = turns[Math.min(served, turns.length - 1)] ?? {};
			served += 1;
			res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
			if (turn.reasoning) res.write(chunk({reasoning_content: turn.reasoning}));
			for (const piece of (turn.text ?? '').match(/\S+\s*/g) ?? []) {
				res.write(chunk({content: piece}));
			}
			res.write(chunk({}, 'stop'));
			const input = turn.inputTokens ?? 33;
			const output = turn.outputTokens ?? 11;
			res.write(
				sse({
					choices: [],
					usage: {prompt_tokens: input, completion_tokens: output, total_tokens: input + output}
				})
			);
			res.write('data: [DONE]\n\n');
			res.end();
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () => new Promise<void>(resolve => server.close(() => resolve()))
	};
}
