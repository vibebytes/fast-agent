/**
 * Backward-compatible entry used by component tests. Production layouts
 * render <Transcript> directly via AppLayout.
 */
import React from 'react';
import type {UiState} from '../state/model.js';
import {Transcript} from './Transcript.js';

type Props = {
	state: UiState;
	/** @deprecated Ignored — Static/epoch removed under the scroll architecture. */
	staticEpoch?: number;
	/** @deprecated Ignored — drift guard removed. */
	onStaticDrift?: (reason: string) => void;
	onQuestionAnswer?: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
};

export function MainContent({state, onQuestionAnswer}: Props) {
	return (
		<Transcript
			state={state}
			overflowToBackbuffer={false}
			stableScrollback={false}
			onQuestionAnswer={onQuestionAnswer}
			scrollActive={false}
		/>
	);
}
