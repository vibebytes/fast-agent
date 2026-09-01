#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App} from './App.js';
import {detectTerminalBackground} from './terminal/backgroundDetect.js';
import {loadSavedRendererMode} from './theme/themeStore.js';
import {alternateScreenAllowed} from './terminal/alternateScreen.js';
import {isScreenReader} from './terminal/capabilityManager.js';

// Probe the terminal background (OSC 11) before Ink takes over stdin, so the
// default theme matches dark/light terminals automatically.
const initialBackground = await detectTerminalBackground();

const savedMode = loadSavedRendererMode();
const wantFullscreen = savedMode === 'fullscreen' && alternateScreenAllowed() && !isScreenReader();
// incrementalRendering is constructor-only (not in setOptions). Enable for
// both inline and fullscreen so /tui switches keep the incremental pipeline;
// shpool / screen readers disable it (gemini-cli policy).
const isShpool = Boolean(process.env['SHPOOL_SESSION_NAME']);
const incrementalRendering = !isShpool && !isScreenReader();
const debugRainbow = process.env['FAST_DEBUG_RAINBOW'] === '1';

render(<App initialBackground={initialBackground} />, {
	// Ctrl+C is handled by the app itself: cancel the running task first,
	// exit only when idle. Ink's default would unmount immediately.
	exitOnCtrlC: false,
	terminalBuffer: true,
	alternateBuffer: wantFullscreen,
	incrementalRendering,
	standardReactLayoutTiming: true,
	stickyHeadersInBackbuffer: wantFullscreen,
	trackSelection: true,
	debugRainbow,
	onRender: ({renderTime}) => {
		if (renderTime > 200 && process.env['FAST_DEBUG'] === '1') {
			process.stderr.write(`[ink] slow frame ${Math.round(renderTime)}ms\n`);
		}
	}
});
