/** DSH-Web 对照文案。字段仍从 schema 来，这里只做人读标签。 */

export const nsCopy: Record<string, {title: string; description?: string}> = {
	permission: {title: '权限', description: '选择新会话的默认权限模式'},
	locale: {title: '语言', description: '只影响 DSH 跟模型说话，不改 IDE 界面语言'},
	'ui-conversation': {title: '繁忙时 Enter 键行为', description: '仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为'},
	'agent-presets': {title: 'Agent 预设', description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。'},
	bash: {title: '终端', description: '限制 agent 运行的每一条命令。'},
	shell: {title: '终端', description: '限制 agent 运行的每一条命令。'},
	'agent-loop': {title: 'Agent 循环', description: 'Agent 如何派发工具调用。'},
	'web-search-deepseek': {title: '网页搜索', description: 'DeepSeek 搜索提供方。'}
};

export const fieldCopy: Record<string, {title: string; description?: string}> = {
	mode: {title: '权限模式'},
	preset: {title: '权限模式'},
	permission: {title: '权限模式'},
	language: {title: '语言'},
	locale: {title: '语言'},
	enter: {title: '繁忙时 Enter 键行为', description: '仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为'},
	busyEnter: {title: '繁忙时 Enter 键行为'},
	submission: {title: '繁忙时 Enter 键行为'},
	timeoutMs: {title: '命令超时（毫秒）', description: '单条命令允许运行多久，超时即终止。'},
	maxOutputBytes: {title: '单流输出上限（字节）', description: '超出部分会转存到临时文件，而不是被丢弃。'},
	maxParallel: {title: '并行工具调用数', description: '同一步内最多同时运行多少个可并行的调用。'},
	maxParallelToolCalls: {title: '并行工具调用数', description: '同一步内最多同时运行多少个可并行的调用。'},
	apiKey: {title: 'API Key', description: '不写入设置文件。留空表示保持当前密钥。'},
	baseUrl: {title: '接口地址', description: '留空则使用提供方默认地址。'},
	baseURL: {title: '接口地址'},
	maxUses: {title: '单次请求最多搜索次数', description: '一次请求在必须作答前最多可以搜索多少次。'}
};

const enumCopy: Record<string, string> = {
	'read-only': 'Read Only',
	readonly: 'Read Only',
	'workspace-write': 'Workspace Write',
	'danger-full-access': 'Full access',
	'full-access': 'Full access',
	zh: '中文',
	en: 'English',
	queue: '排队发送',
	steer: '插话发送'
};

const presetCopy: Record<string, {name: string; description: string}> = {
	standard: {
		name: '标准模式',
		description: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。'
	},
	code: {
		name: 'PTC 模式',
		description: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。'
	},
	minimal: {
		name: '极简模式',
		description: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。'
	},
	cordis: {
		name: '创造模式',
		description: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。'
	}
};

export function nsTitle(ns: string, fallback?: string): string {
	return nsCopy[ns]?.title ?? fallback ?? ns;
}

export function nsDescription(ns: string): string | undefined {
	return nsCopy[ns]?.description;
}

export function fieldTitle(key: string, fallback?: string): string {
	return fieldCopy[key]?.title ?? fallback ?? key;
}

export function fieldDescription(key: string, fallback?: string): string | undefined {
	return fieldCopy[key]?.description ?? fallback;
}

export function enumLabel(value: string): string {
	return enumCopy[value] ?? value;
}

export function presetName(id: string, fallback?: string): string {
	return presetCopy[id]?.name ?? fallback ?? id;
}

export function presetDescription(id: string, fallback?: string): string | undefined {
	return presetCopy[id]?.description ?? fallback;
}

/** DSH-Web `ui-agent-preset` 中文对照。 */
export const presetsCopy = {
	intro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
	loading: '正在加载预设…',
	empty: '没有 Agent 预设',
	emptyHint: 'DSH 没有返回任何预设。进程起来后可重试。',
	emptyContent: '（空）',
	builtIn: '内置',
	custom: '自定义',
	builtInTag: '内置',
	userTrust: '自定义',
	setDefault: '设为默认',
	inUse: '当前使用',
	sessionUse: '本会话',
	useSession: '用于当前会话',
	needSession: '需要一个空白会话才能换当前预设。',
	view: '查看',
	duplicate: '复制',
	duplicateUnavailable: '此部署未配置可写的预设目录',
	delete: '删除',
	presetId: '标识符',
	presetIdPlaceholder: 'my-agent',
	displayName: '名称',
	displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
	noDescription: '暂无描述。',
	brokenBadge: '加载失败',
	brokenNoCopy: '预设加载失败，不能复制',
	copyOf: '复制自',
	composition: '组装（agent.cordis.yml）',
	cancel: '取消',
	close: '关闭',
	copyTitle: '复制预设',
	copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
	create: '创建',
	creating: '正在创建…',
	creatorDraft: '+ 用「创造模式」创作自定义预设',
	openLocation: '打开目录',
	showLocation: '查看路径',
	revealedPathLabel: '预设文件：',
	idRequired: '请填写标识符。',
	idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
	idTaken: '该标识符已被占用。',
	deleteTitle: '删除该预设？',
	deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
	deleteConfirm: '删除'
};

/** DSH-Web `ui-settings-plugins` / `ui-settings-plugin-inventory` 中文对照。 */
export const pluginsCopy = {
	configTab: '插件配置',
	listTab: '插件列表',
	empty: '本部署没有开放任何插件设置。',
	overridden: '已覆盖',
	reset: '恢复默认',
	readOnly: '本部署的设置为只读。',
	save: '保存',
	saving: '保存中…',
	discard: '放弃修改',
	unsaved: '未保存',
	saveFailed: '本部署没有接受这些值，已保留供你修改。',
	invalidNumber: '请填数字；留空表示使用默认值。',
	keySet: '已配置密钥。',
	keyUnset: '未配置密钥；配置之前搜索不可用。',
	keyStored: '已配置——输入新值可替换',
	conflict: '这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开。',
	search: '搜索插件',
	catalog: '插件列表',
	listLoading: '正在读取插件…',
	listError: '暂时无法读取插件。',
	listEmpty: '暂无插件。',
	listEmptySearch: '没有匹配的插件。',
	enabled: '已启用',
	disabled: '已停用',
	configuration: '配置状态',
	cordis: 'Cordis 状态'
};

/** DSH-Web `ui-settings-models` 中文对照。 */
export const modelsCopy = {
	edit: '编辑',
	remove: '删除',
	add: '添加提供方',
	customAdd: '添加自定义提供方',
	provider: '提供方',
	cancel: '取消',
	apply: '保存',
	create: '创建提供方',
	customTag: '自定义',
	keyInput: 'API 密钥',
	keyPlaceholder: '输入 API 密钥',
	keyPlaceholderNative: '输入 API 密钥，或留空使用环境认证',
	keyStored: '已配置——输入新值可替换',
	keyEnvLocked: '由启动环境提供（只读）',
	keyBlank: '请输入 API 密钥；留空则保持已存储的密钥。',
	keyIllegal: '该 API 密钥格式错误，请检查。',
	customized: '自定义设置',
	baseUrl: 'API 地址',
	baseUrlDefault: '提供方默认',
	models: '模型目录',
	modelsInherited: '正在使用适配器默认模型',
	modelsCustomized: '已自定义模型目录',
	resetModels: '恢复默认模型',
	modelId: '模型 ID',
	modelName: '显示名称',
	addModel: '添加模型',
	modelIdRequired: '模型 ID 不能为空。',
	modelIdDuplicate: '模型 ID 不能重复。',
	modelsEmpty: '模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。',
	fetchModels: '获取可用模型',
	fetchNeedsBaseUrl: '请先填写 API 地址，再获取。',
	customTitle: '自定义提供方',
	customRoute: 'Provider ID',
	customRouteHint: '以小写字母开头的标识，在请求中唯一标识该提供方，并用于派生凭据名。',
	customRouteInvalid: '需以小写字母开头，之后可用小写字母、数字和短横线。',
	customRouteTaken: '已有提供方使用了这个 ID。',
	customDisplayName: '显示名称',
	customApi: 'API 协议',
	customNeedsBaseUrl: '自定义提供方需要填写 API 地址。',
	customNeedsModels: '自定义提供方至少需要一个模型。',
	deleteTitle: '删除该提供方？',
	deleteWithKey: '会移除其配置和存储的 API 密钥。',
	deleteKeepKey: '会移除其配置；凭证由其他位置管理，将会保留。',
	configured: 'API 密钥已配置',
	missing: 'API 密钥缺失',
	conflict: '这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开。'
};

export function failText(error: {code: string; message?: string}): string {
	if (error.code === 'settings-conflict' || error.code === 'revision-stale') {
		return '这张卡片打开期间，这些设置已被其他地方改动。已刷新，请再试一次。';
	}
	if (error.code === 'credential-rejected') return '来自环境或文件，只读';
	if (error.code === 'agent-preset-locked') return '当前会话已跑过一轮，不能换预设';
	if (error.code === 'unavailable') {
		if (error.message === 'dsh process off') return '未连上 DSH（默认 127.0.0.1:3080），请先开 DSH 再重试';
		return error.message ?? 'DSH 未就绪，请重试';
	}
	return error.message ?? error.code;
}
