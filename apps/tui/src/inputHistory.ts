import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const maxHistoryEntries = 500;

export function historyFilePath(): string {
	return path.join(os.homedir(), '.fast', 'history');
}

export function normalizeHistory(lines: string[], maxEntries = maxHistoryEntries): string[] {
	const cleaned = lines.map(line => line.trim()).filter(line => line.length > 0);
	const deduped: string[] = [];
	for (const line of cleaned) {
		if (deduped.at(-1) !== line) {
			deduped.push(line);
		}
	}
	return deduped.slice(-maxEntries);
}

export function loadHistory(file = historyFilePath()): string[] {
	try {
		if (!fs.existsSync(file)) {
			return [];
		}
		return normalizeHistory(fs.readFileSync(file, 'utf8').split(/\r?\n/));
	} catch {
		return [];
	}
}

export function appendHistoryEntry(entry: string, current: string[], file = historyFilePath()): string[] {
	const trimmed = entry.trim();
	if (trimmed.length === 0) {
		return current;
	}
	const next = normalizeHistory([...current, trimmed]);
	if (next.at(-1) !== current.at(-1)) {
		fs.mkdirSync(path.dirname(file), {recursive: true});
		fs.appendFileSync(file, `${trimmed}\n`, 'utf8');
	}
	return next;
}
