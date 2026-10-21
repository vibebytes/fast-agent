import type {ReactNode} from 'react';

/** Lightweight keyword tint for common shell log lines (WARN / error / Done) & file path links. */
export function tintOutputLine(line: string): ReactNode {
	if (!line || line.trim() === '') return ' ';

	const fileMatch = /^(\s*)([a-zA-Z0-9_.\-\/\\]+\.[a-zA-Z0-9]+)(:\d+(?::\d+)?:?)(.*)$/.exec(line);
	if (fileMatch) {
		const [, indent, filePath, lineCol, rest] = fileMatch;
		return (
			<>
				{indent}
				<span className="font-medium text-foreground/90">{filePath}</span>
				<span className="font-mono text-primary/80">{lineCol}</span>
				{rest ? tintOutputLine(rest) : null}
			</>
		);
	}

	if (/^\s*WARN(?:ING)?\b/i.test(line) || /\bWARN\b/.test(line)) {
		return <span className="text-amber-700 dark:text-amber-400">{line}</span>;
	}
	if (/^\s*(?:ERROR|ERR|FAIL(?:ED)?)\b/i.test(line) || (/\berror\b/i.test(line) && /failed/i.test(line))) {
		return <span className="text-red-600 dark:text-red-400">{line}</span>;
	}
	if (/^\s*Done\b/i.test(line) || /\bsuccess\b/i.test(line)) {
		return <span className="text-emerald-700 dark:text-emerald-400">{line}</span>;
	}
	if (/^\s*\+\d+/.test(line) || /\+\+$/.test(line.trim())) {
		return <span className="text-emerald-600 dark:text-emerald-400">{line}</span>;
	}
	return line;
}
