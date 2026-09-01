import type {
	ApprovalReason,
	ApprovalTitle,
	ApprovalViewModel,
	ApprovalViewModelEn,
	RiskBadge,
	ShellIntent,
	SubjectLabel
} from '@fast-ide/session-view';
import type {TFunction} from 'i18next';

export function formatApprovalTitle(title: ApprovalTitle, t: TFunction): string {
	switch (title.kind) {
		case 'external_directory':
			return t('session.approval.title.external_directory');
		case 'bash':
			return t('session.approval.title.bash');
		case 'bash_unsandboxed':
			return t('session.approval.title.bash_unsandboxed');
		case 'delete_file':
			return t('session.approval.title.delete_file');
		case 'git':
			return t('session.approval.title.git');
		case 'write_file':
			return t('session.approval.title.write_file');
		case 'edit_file':
			return t('session.approval.title.edit_file');
		case 'define_subagent':
			return t('session.approval.title.define_subagent');
		case 'subagent':
			return title.name
				? t('session.approval.title.subagentNamed', {name: title.name})
				: t('session.approval.title.subagent');
		case 'mcp_tool':
			if (title.server && title.tool) {
				return t('session.approval.title.mcp_toolQualified', {
					server: title.server,
					tool: title.tool
				});
			}
			if (title.tool) return t('session.approval.title.mcp_toolNamed', {tool: title.tool});
			return t('session.approval.title.mcp_tool');
		case 'tool':
			return t('session.approval.title.tool', {tool: title.tool});
	}
}

export function formatRiskBadge(
	badge: RiskBadge | null,
	t: TFunction,
	riskRaw?: string
): string | null {
	if (badge) return t(`session.approval.risk.${badge}`);
	return riskRaw ?? null;
}

export function formatSubjectLabel(label: SubjectLabel, t: TFunction): string {
	return t(`session.approval.label.${label}`);
}

export function formatApprovalReason(reason: ApprovalReason, t: TFunction): string {
	switch (reason.kind) {
		case 'external_directory':
			return t('session.approval.reason.external_directory');
		case 'unsandboxed':
			return t('session.approval.reason.unsandboxed');
		case 'shell':
			return t(`session.approval.shell_risk.${reason.risk}`);
		case 'delete_file':
			return t('session.approval.reason.delete_file');
		case 'git':
			return t('session.approval.reason.git');
		case 'workspace_write':
			return t('session.approval.reason.workspace_write');
		case 'subagent':
			return t('session.approval.reason.subagent');
		case 'mcp':
			return t('session.approval.reason.mcp');
		case 'generic_with_risk':
			return t('session.approval.reason.generic_with_risk', {risk: reason.risk});
		case 'generic':
			return t('session.approval.reason.generic');
	}
}

export function formatShellIntent(intent: ShellIntent, t: TFunction): string {
	return t(`session.approval.shell_intent.${intent}`);
}

export function formatApproval(view: ApprovalViewModel, t: TFunction): ApprovalViewModelEn {
	return {
		title: formatApprovalTitle(view.title, t),
		riskLabel: formatRiskBadge(view.riskBadge, t, view.riskRaw),
		subjectLabel: formatSubjectLabel(view.subjectLabel, t),
		subject: view.subject,
		secondaryLabel: view.secondaryLabel
			? formatSubjectLabel(view.secondaryLabel, t)
			: undefined,
		secondary: view.secondary,
		reason: formatApprovalReason(view.reason, t)
	};
}
