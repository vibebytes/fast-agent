import React, {useEffect, useState} from 'react';
import {Box, Text, render, useApp} from 'ink';
import {ThemeProvider} from '../contexts/ThemeContext.js';
import {ToolGroupMessage} from '../components/tools/ToolGroupMessage.js';
import type {ToolRun} from '../state/model.js';

const STEPS = 121;

function buildTool(step: number): ToolRun {
	const longOutSignature = `PTY-LONG-SIGN-${step}`;
	const longErrSignature = `PTY-LONG-ERR-${step}`;
	const stdoutPayload = step % 2 === 0
		? `${longOutSignature}-${'o'.repeat(180)}`
		: `PTY-SHORT-SIGN-${step}`;
	const stderrPayload = step % 2 === 0
		? `${longErrSignature}-${'e'.repeat(140)}`
		: `PTY-SHORT-ERR-${step}`;

	return {
		id: 'pty_tool',
		tool: 'shell',
		args: {command: `bash pty-step-${step}.sh`},
		output: [
			{stream: 'stdout', text: `PTY-MARK-${step} ${stdoutPayload}\nstdout-${step}`},
			{stream: 'stderr', text: `PTY-ERR-MARK-${step} ${stderrPayload}\nstderr-${step}`}
		],
		status: 'success',
		fields: {exit: '0'}
	};
}

function PtyReplayApp() {
	const {exit} = useApp();
	const [step, setStep] = useState(0);
	const done = step >= STEPS;

	useEffect(() => {
		if (done) {
			const timer = setTimeout(() => exit(), 120);
			return () => clearTimeout(timer);
		}

		const timer = setTimeout(() => setStep(current => current + 1), 8);
		return () => clearTimeout(timer);
	}, [step, done, exit]);

	return (
		<ThemeProvider themeName="no-color" setThemeName={() => undefined}>
			<Box flexDirection="column" width={72}>
				<Text>{`PTY-STEP-${step}`}</Text>
				<ToolGroupMessage expanded tools={[buildTool(step)]} />
				{done && (
					<Box flexDirection="column">
						<Text>{`PTY-FINAL-MARK-${step}`}</Text>
						<Text>{`PTY-FINAL-STDERR-${step}`}</Text>
					</Box>
				)}
			</Box>
		</ThemeProvider>
	);
}

render(<PtyReplayApp />);
