import {BrowserWindow, Notification} from 'electron';
import {mainI18n} from '../i18n';

export type SystemNotifyInput = {
	kind: 'approval' | 'turn_finished';
	taskId: string | null;
	taskTitle: string | null;
	detail?: string;
	success?: boolean;
};

/** Structural port so uiPublisher stays Electron-free in node tests. */
export type SystemNotifyPort = {
	notify(input: SystemNotifyInput): void;
};

export type SystemNotifierOptions = {
	onActivate?: (taskId: string) => void;
};

const BODY_MAX = 140;

function clip(text: string): string {
	return text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX - 1)}…`;
}

/**
 * OS-level notifications for「需要审批」and「turn 结束」.
 * Silent by design — completion/approval chimes already cover audio.
 */
export function createSystemNotifier(options: SystemNotifierOptions = {}): SystemNotifyPort & {
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
} {
	let enabled = false;

	function focusWindow(): void {
		const windows = BrowserWindow.getAllWindows();
		const win = windows.find(w => w.isVisible()) ?? windows[0];
		if (!win) return;
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	}

	return {
		setEnabled(next: boolean): void {
			enabled = next;
		},
		isEnabled(): boolean {
			return enabled;
		},
		notify(input: SystemNotifyInput): void {
			if (!enabled || !Notification.isSupported()) return;
			// Foreground courtesy: never pop while the user is already looking at the app.
			const windows = BrowserWindow.getAllWindows();
			if (windows.length > 0 && windows.some(w => w.isFocused())) return;
			const t = mainI18n().t.bind(mainI18n());
			const where = input.taskTitle ? `${input.taskTitle}: ` : '';
			const notification =
				input.kind === 'approval'
					? new Notification({
							title: t('shell.notify.approvalTitle'),
							body: clip(`${where}${input.detail ?? ''}`.trim()),
							silent: true
						})
					: new Notification({
							title: t(
								input.success === false ? 'shell.notify.turnFailTitle' : 'shell.notify.turnDoneTitle'
							),
							body: clip(input.taskTitle ?? ''),
							silent: true
						});
			notification.on('click', () => {
				focusWindow();
				if (input.taskId) options.onActivate?.(input.taskId);
			});
			notification.show();
		}
	};
}
