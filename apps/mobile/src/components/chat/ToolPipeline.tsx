import {
  countDiffStats,
  parseDiffWithLineNumbers,
  type DiffLine
} from '@fast-ide/session-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

export type ToolLike = {
  id: string;
  tool: string;
  args?: Record<string, string>;
  output?: string;
  status: string;
  statusNote?: string;
};

type ToolCat = 'shell' | 'file' | 'search' | 'git' | 'agent' | 'system';

const TOOL_COPY: Record<ToolCat, string> = {
  shell: 'mobile.chat.toolShell',
  file: 'mobile.chat.toolFile',
  search: 'mobile.chat.toolSearch',
  git: 'mobile.chat.toolGit',
  agent: 'mobile.chat.toolAgent',
  system: 'mobile.chat.toolSystem'
};

export function getToolCategory(toolName: string): { icon: string; cat: ToolCat } {
  const name = toolName.toLowerCase();
  if (name.includes('shell') || name.includes('bash') || name.includes('terminal') || name.includes('exec')) {
    return { icon: '⚡', cat: 'shell' };
  }
  if (name.includes('edit') || name.includes('write') || name.includes('delete') || name.includes('patch')) {
    return { icon: '📝', cat: 'file' };
  }
  if (name.includes('read') || name.includes('grep') || name.includes('glob') || name.includes('find') || name.includes('search')) {
    return { icon: '🔍', cat: 'search' };
  }
  if (name.includes('git')) {
    return { icon: '🌿', cat: 'git' };
  }
  if (name.includes('agent') || name.includes('skill') || name.includes('goal')) {
    return { icon: '🤖', cat: 'agent' };
  }
  return { icon: '⚙️', cat: 'system' };
}

export function diffTextOf(tool: ToolLike): string | undefined {
  const candidate = tool.args?.diff ?? tool.args?.patch ?? tool.args?.contents;
  if (candidate && (candidate.includes('@@ -') || candidate.includes('+++') || candidate.includes('---'))) {
    return candidate;
  }
  if (tool.output && /^(diff --git |\+\+\+ |@@ -)/m.test(tool.output)) return tool.output;
  return undefined;
}

export function DiffLineRow({ line }: { line: DiffLine }) {
  const style =
    line.type === 'add' ? 'bg-success/15' : line.type === 'del' ? 'bg-danger/15' : line.type === 'hunk' ? 'bg-surface-tertiary' : '';
  const color = line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-foreground';
  return (
    <Text className={`px-2 py-0.5 font-mono text-[11px] leading-4 ${style} ${color}`} selectable>
      {line.type === 'add' ? `+ ${line.content}` : line.type === 'del' ? `- ${line.content}` : line.content}
    </Text>
  );
}

export function FullSheet({
  visible,
  title,
  subtitle,
  onClose,
  children
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <GlassHeader className="flex-row items-center justify-between px-4 pb-3 pt-2">
          <View className="flex-1 pr-2">
            <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} className="font-mono text-[13px] text-muted">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} className="min-h-11 justify-center px-2 active:opacity-60">
            <Text className="text-[15px] font-semibold text-link">{t('mobile.chat.done')}</Text>
          </Pressable>
        </GlassHeader>
        <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />
        <ScrollView horizontal className="flex-1">
          <ScrollView className="min-w-full p-4">{children}</ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function toolHint(tool: ToolLike): string {
  const args = tool.args ?? {};
  return tool.statusNote || args.path || args.command || args.query || args.pattern || args.file || args.name || '';
}

export function ToolDetailSheet({ tool, onClose }: { tool: ToolLike | null; onClose: () => void }) {
  const { t } = useTranslation();
  const diffText = tool ? diffTextOf(tool) : undefined;
  const lines = useMemo(() => (diffText ? parseDiffWithLineNumbers(diffText) : []), [diffText]);
  const stats = countDiffStats(diffText);
  if (!tool) return null;
  const { icon, cat } = getToolCategory(tool.tool);
  const label = t(TOOL_COPY[cat]);
  return (
    <FullSheet visible title={`${icon} ${tool.tool}`} subtitle={toolHint(tool) || label} onClose={onClose}>
      {diffText ? (
        <View className="overflow-hidden rounded-2xl bg-surface-secondary">
          <View className="flex-row items-center justify-between px-3 py-2">
            <Text className="text-[13px] font-semibold text-muted">{t('mobile.chat.diffTitle')}</Text>
            <View className="flex-row gap-2">
              <Text className="font-mono text-[13px] font-bold text-success">+{stats.add}</Text>
              <Text className="font-mono text-[13px] font-bold text-danger">−{stats.del}</Text>
            </View>
          </View>
          <View className="pb-2">
            {lines.map((line: DiffLine, i: number) => (
              <DiffLineRow key={i} line={line} />
            ))}
          </View>
        </View>
      ) : (
        <View className="rounded-2xl bg-surface-secondary p-3.5">
          <Text className="font-mono text-[13px] leading-5 text-foreground" selectable>
            {tool.output || toolHint(tool) || t('mobile.chat.stepEmpty')}
          </Text>
        </View>
      )}
    </FullSheet>
  );
}

function StepMark({ status }: { status: string }) {
  const vars = useThemeVars();
  if (status === 'running') return <View className="h-2 w-2 rounded-full bg-focus" />;
  if (status === 'error' || status === 'cancelled') return <Glyph name="cross" size={13} color={vars['--danger']} />;
  return <Glyph name="check" size={13} color={vars['--muted']} />;
}

export function AgentToolPipeline({ tools, initiallyOpen = false }: { tools: ToolLike[]; initiallyOpen?: boolean }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const anyRunning = tools.some((x) => x.status === 'running');
  const [open, setOpen] = useState(initiallyOpen || anyRunning);
  const [detail, setDetail] = useState<ToolLike | null>(null);
  const touched = useRef(initiallyOpen);

  useEffect(() => {
    if (touched.current) return;
    setOpen(anyRunning);
  }, [anyRunning]);

  if (tools.length === 0) return null;

  const errorCount = tools.filter((x) => x.status === 'error' || x.status === 'cancelled').length;
  const successCount = tools.filter((x) => x.status === 'success').length;

  return (
    <View className="mt-2 overflow-hidden rounded-2xl bg-surface-secondary">
      {initiallyOpen ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            touched.current = true;
            setOpen((v) => !v);
          }}
          className="min-h-11 flex-row items-center justify-between px-3.5 active:opacity-60"
        >
          <View className="flex-1 flex-row items-center gap-2">
            <StepMark status={anyRunning ? 'running' : errorCount > 0 ? 'error' : 'success'} />
            <Text numberOfLines={1} className="text-[13px] font-semibold text-surface-secondary-foreground">
              {anyRunning
                ? t('mobile.chat.pipelineRunning', { current: successCount + 1, total: tools.length })
                : t('mobile.chat.pipelineDone', { count: tools.length })}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {errorCount > 0 ? (
              <Text className="text-[11px] font-semibold text-danger">{t('mobile.chat.errorCount', { count: errorCount })}</Text>
            ) : null}
            <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={14} color={vars['--muted']} />
          </View>
        </Pressable>
      )}

      {open ? (
        <View className="px-1.5 py-1">
          {tools.map((tool, idx) => {
            const hint = toolHint(tool);
            const hasDiff = Boolean(diffTextOf(tool));
            return (
              <Pressable
                key={tool.id || idx}
                accessibilityRole="button"
                onPress={() => setDetail(tool)}
                className="min-h-11 flex-row items-center gap-2.5 rounded-xl px-2 py-1.5 active:bg-surface-tertiary"
              >
                <View className="w-4 items-center">
                  <StepMark status={tool.status} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-mono text-[13px] text-surface-secondary-foreground">
                    {tool.tool}
                  </Text>
                  {hint ? (
                    <Text numberOfLines={1} className="font-mono text-[11px] text-muted">
                      {hint}
                    </Text>
                  ) : null}
                </View>
                {hasDiff ? <Text className="text-[11px] font-semibold text-link">Diff</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ToolDetailSheet tool={detail} onClose={() => setDetail(null)} />
    </View>
  );
}
