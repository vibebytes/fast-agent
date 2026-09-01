/**
 * Centralized user-visible strings for the Ink CLI UI.
 * Keep ALL display copy here so wording stays consistent across components.
 * NOTE: several of these are pinned by snapshot tests (inkSnapshots.test.tsx,
 * inkStress.test.tsx, ptyAppSmoke.test.ts) — update tests when changing copy.
 */
export const STR = {
	// Composer / status bar
	readyHint: '输入消息，或 /help 查看命令',
	queuedNotice: '已排队：将在当前任务完成后自动发送',
	engineStarting: '引擎启动中…',
	approvalPlaceholder: '等待批准：Enter 允许 · Esc 拒绝',
	approvalPausedNotice: '⏸ 运行已暂停，等待审批…',
	questionPlaceholder: '输入回答，或选择上方选项',

	// Thinking block
	thinking: 'Thinking',
	cancelHint: 'Esc 取消',
	hiddenThinking: (n: number) => `… 已折叠 ${n} 行思考`,

	// Tool rendering
	running: '运行中…',
	runningSilent: (n: number) => `运行中… ${n}s 无输出`,
	noOutput: '(无输出)',
	emptyFile: '空文件',
	lineCount: (n: number) => `${n} 行`,
	stderrOnlyTag: 'stderr',
	deniedTag: '已拒绝',
	failedTag: '失败',
	expandSuffix: ' (Ctrl+O 展开)',
	toolsDone: (n: number) => `${n} 完成`,
	toolsRunning: (n: number) => `${n} 运行中`,
	toolsFailed: (n: number) => `${n} 失败`,
	readFiles: (n: number) => `读取 ${n} 个文件`,
	listedDirs: (n: number) => `列目录 ${n} 次`,
	hiddenLines: (n: number) => `… +${n} 行 (Ctrl+O 展开)`,
	hiddenFiles: (n: number) => `… +${n} 个文件 (Ctrl+O 展开)`,
	hiddenCommandLines: (n: number) => `… 命令还有 ${n} 行 (Ctrl+O 展开)`,

	// Markdown / code blocks
	alreadyPrinted: (n: number) => `↑ ${n} 行已输出在上方`,
	codeGenerating: '生成中…',

	// Layouts
	scrolledUpHint: (offset: number) => `↑ 已上翻 ${offset} 行 · End 回到底部`,
	overflowAggregate: (n: number) => `… ${n} 行已折叠`,
};
