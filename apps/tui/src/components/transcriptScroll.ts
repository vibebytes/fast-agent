/**
 * Pure stick-to-bottom scroll state machine for the Transcript viewport.
 * Decoupled from React so every transition can be exhaustively unit-tested.
 */

export type ScrollState = {
	scrollTop: number;
	scrollHeight: number;
	innerHeight: number;
	isSticking: boolean;
};

export type ScrollEvent =
	| {type: 'content'; scrollHeight: number}
	| {type: 'resize'; innerHeight: number}
	| {type: 'scrollBy'; delta: number}
	| {type: 'scrollTo'; scrollTop: number}
	| {type: 'scrollToEnd'}
	| {type: 'forceStick'};

export function maxScrollTop(state: Pick<ScrollState, 'scrollHeight' | 'innerHeight'>): number {
	return Math.max(0, state.scrollHeight - state.innerHeight);
}

export function initialScrollState(innerHeight: number, scrollHeight = 0): ScrollState {
	const base = {scrollTop: 0, scrollHeight, innerHeight, isSticking: true};
	return {
		...base,
		scrollTop: maxScrollTop(base)
	};
}

export function reduceScroll(state: ScrollState, event: ScrollEvent): ScrollState {
	switch (event.type) {
		case 'content': {
			const next = {...state, scrollHeight: event.scrollHeight};
			if (state.isSticking) {
				return {...next, scrollTop: maxScrollTop(next)};
			}
			return {...next, scrollTop: Math.min(state.scrollTop, maxScrollTop(next))};
		}
		case 'resize': {
			const next = {...state, innerHeight: event.innerHeight};
			if (state.isSticking) {
				return {...next, scrollTop: maxScrollTop(next)};
			}
			return {...next, scrollTop: Math.min(state.scrollTop, maxScrollTop(next))};
		}
		case 'scrollBy': {
			const nextTop = Math.max(0, Math.min(maxScrollTop(state), state.scrollTop + event.delta));
			return {...state, scrollTop: nextTop, isSticking: nextTop >= maxScrollTop(state)};
		}
		case 'scrollTo': {
			const nextTop = Math.max(0, Math.min(maxScrollTop(state), event.scrollTop));
			return {...state, scrollTop: nextTop, isSticking: nextTop >= maxScrollTop(state)};
		}
		case 'scrollToEnd':
		case 'forceStick': {
			return {
				...state,
				scrollTop: maxScrollTop(state),
				isSticking: true
			};
		}
	}
}
