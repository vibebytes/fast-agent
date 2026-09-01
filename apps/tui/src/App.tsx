import React from 'react';
import {AppContainer} from './AppContainer.js';
import type {BackgroundInfo} from './terminal/backgroundDetect.js';

export function App({initialBackground}: {initialBackground?: BackgroundInfo}) {
	return <AppContainer initialBackground={initialBackground} />;
}
