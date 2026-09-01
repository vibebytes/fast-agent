export function terminalColumns(): number {
	return process.stdout.columns ?? 100;
}
