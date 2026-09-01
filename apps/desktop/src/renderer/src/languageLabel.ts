const LABELS: Record<string, string> = {
	typescript: 'TypeScript',
	javascript: 'JavaScript',
	json: 'JSON',
	markdown: 'Markdown',
	css: 'CSS',
	scss: 'SCSS',
	less: 'Less',
	html: 'HTML',
	xml: 'XML',
	yaml: 'YAML',
	ini: 'INI',
	python: 'Python',
	ruby: 'Ruby',
	go: 'Go',
	rust: 'Rust',
	java: 'Java',
	kotlin: 'Kotlin',
	swift: 'Swift',
	c: 'C',
	cpp: 'C++',
	csharp: 'C#',
	php: 'PHP',
	sql: 'SQL',
	shell: 'Shell',
	powershell: 'PowerShell',
	dockerfile: 'Dockerfile',
	scala: 'Scala',
	r: 'R',
	lua: 'Lua',
	dart: 'Dart',
	graphql: 'GraphQL',
	plaintext: 'Plain Text'
};

export function languageLabel(languageId: string): string {
	return LABELS[languageId] ?? languageId;
}
