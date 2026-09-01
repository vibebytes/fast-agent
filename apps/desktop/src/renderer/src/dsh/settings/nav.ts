import {Bot, Boxes, SlidersHorizontal, UsersRound} from 'lucide-react';
import type {SettingsIcon} from '../../settings/SettingsPrimitives';

export type DshSection = 'general' | 'models' | 'plugins' | 'agent-presets';

export const dshSections: Array<{
	id: DshSection;
	icon: SettingsIcon;
	copyKey: string;
	title: string;
	description: string;
}> = [
	{
		id: 'general',
		icon: SlidersHorizontal,
		copyKey: 'general',
		title: '通用设置',
		description: 'Agent 预设、权限、语言与繁忙时 Enter'
	},
	{
		id: 'models',
		icon: Bot,
		copyKey: 'models',
		title: '模型',
		description: '填入各提供方的 API 密钥即可使用其模型'
	},
	{
		id: 'plugins',
		icon: Boxes,
		copyKey: 'plugins',
		title: '插件',
		description: '配置和查看本部署已安装的插件。'
	},
	{
		id: 'agent-presets',
		icon: UsersRound,
		copyKey: 'agents',
		title: 'Agent 预设',
		description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。'
	}
];

/** Live DSH terminal ns is `shell`; `bash` is the old alias. */
export const pluginNamespaces = ['shell', 'bash', 'agent-loop', 'web-search-deepseek'] as const;
