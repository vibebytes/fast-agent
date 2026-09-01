import type {FileOp, ThoughtChrome} from '@fast-ide/session-view';
import type {TFunction} from 'i18next';

export function formatThoughtChrome(chrome: ThoughtChrome, t: TFunction): string {
	switch (chrome.kind) {
		case 'open':
			return t('session.thought.open');
		case 'brief':
			return t('session.thought.brief');
		case 'done':
			return t('session.thought.done');
		case 'duration':
			return t('session.thought.duration', {seconds: chrome.seconds});
		case 'network':
			if (chrome.phase === 'retrying' && chrome.attempt != null && chrome.maxAttempts != null) {
				return t('session.network.reconnectingProgress', {
					attempt: chrome.attempt,
					maxAttempts: chrome.maxAttempts
				});
			}
			if (chrome.phase === 'retrying') return t('session.network.reconnecting');
			return t('session.network.waiting');
	}
}

export function formatFileOp(op: FileOp, t: TFunction): string {
	return t(`session.file.${op}`);
}
