import {
  countDiffStats,
  parseDiffWithLineNumbers,
  type DiffLine
} from '@fast-ide/session-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

type ToolLike = {
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
    line.type === 'add'
      ? 'bg-success/15'
      : line.type === 'del'
        ? 'bg-destructive/15'
        : line.type === 'hunk'
          ? 'bg-surface-secondary/80'
          : '';
  const color =
    line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-destructive' : 'text-foreground';
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
        <GlassHeader
          fallbackClassName="bg-surface-secondary"
          className="flex-row items-center justify-between border-b border-border/80 px-4 pb-3"
        >
          <View className="flex-1 pr-2">
            <Text numberOfLines={1} className="text-base font-semibold text-foreground">
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} className="font-mono text-xs text-muted">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            className="rounded-xl bg-surface-secondary px-3.5 py-1.5 active:opacity-75"
          >
            <Text className="text-xs font-semibold text-foreground">{t('mobile.chat.done')}</Text>
          </Pressable>
        </GlassHeader>
        <ScrollView horizontal className="flex-1">
          <ScrollView className="min-w-full p-4">{children}</ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function toolHint(tool: ToolLike): string {
  const args = tool.args ?? {};
  return (
    tool.statusNote ||
    args.path ||
    args.command ||
    args.query ||
    args.pattern ||
    args.file ||
    args.name ||
    ''
  );
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
    <FullSheet
      visible
      title={`${icon} ${tool.tool}`}
      subtitle={toolHint(tool) || label}
      onClose={onClose}
    >
      {diffText ? (
        <View className="overflow-hidden rounded-xl border border-border bg-surface">
          <View className="flex-row items-center justify-between border-b border-border bg-surface-secondary px-3 py-2">
            <Text className="text-xs font-semibold text-muted">{t('mobile.chat.diffTitle')}</Text>
            <View className="flex-row gap-2">
              <Text className="text-xs font-mono font-bold text-success">+{stats.add}</Text>
              <Text className="text-xs font-mono font-bold text-destructive">-{stats.del}</Text>
            </View>
          </View>
          <View className="p-2">
            {lines.map((line: DiffLine, i: number) => (
              <DiffLineRow key={i} line={line} />
            ))}
          </View>
        </View>
      ) : (
        <View className="rounded-xl border border-border bg-surface p-3.5">
          <Text className="font-mono text-xs leading-5 text-foreground" selectable>
            {tool.output || toolHint(tool) || t('mobile.chat.stepEmpty')}
          </Text>
        </View>
      )}
    </FullSheet>
  );
}

export function AgentToolPipeline({ tools }: { tools: ToolLike[] }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const anyRunning = tools.some((t) => t.status === 'running');
  const [open, setOpen] = useState(anyRunning);
  const [detail, setDetail] = useState<ToolLike | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (touched.current) return;
    setOpen(anyRunning);
  }, [anyRunning]);

  if (tools.length === 0) return null;

  const runningCount = tools.filter((t) => t.status === 'running').length;
  const errorCount = tools.filter((t) => t.status === 'error' || t.status === 'cancelled').length;
  const successCount = tools.filter((t) => t.status === 'success').length;

  return (
    <View className="mt-2.5 overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-xs">
      {/* Pipeline Header Summary */}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          touched.current = true;
          setOpen((v) => !v);
        }}
        className="min-h-[44px] flex-row items-center justify-between px-3.5 py-2.5 active:bg-surface-secondary/60"
      >
        <View className="flex-1 flex-row items-center gap-2">
          {anyRunning ? (
            <View className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
          ) : errorCount > 0 ? (
            <View className="h-2 w-2 rounded-full bg-destructive" />
          ) : (
            <View className="h-2 w-2 rounded-full bg-success" />
          )}
          <Text numberOfLines={1} className="text-xs font-semibold text-foreground">
            {anyRunning
              ? t('mobile.chat.pipelineRunning', { current: successCount + 1, total: tools.length })
              : t('mobile.chat.pipelineDone', { count: tools.length })}
          </Text>
        </View>

        <View className="flex-row items-center gap-1.5">
          {errorCount > 0 ? (
            <View className="rounded-md bg-destructive/15 px-1.5 py-0.5">
              <Text className="text-[10px] font-bold text-destructive">{t('mobile.chat.errorCount', { count: errorCount })}</Text>
            </View>
          ) : null}
          <Glyph
            name={open ? 'chevron-down' : 'chevron-right'}
            size={14}
            color={vars['--muted']}
          />
        </View>
      </Pressable>

      {/* Expanded Timeline Steps */}
      {open ? (
        <View className="border-t border-border/60 bg-surface-secondary/25 px-3 py-2">
          {tools.map((tool, idx) => {
            const hint = toolHint(tool);
            const hasDiff = Boolean(diffTextOf(tool));
            const isRunning = tool.status === 'running';
            const isError = tool.status === 'error' || tool.status === 'cancelled';
            const isLast = idx === tools.length - 1;
            const { icon } = getToolCategory(tool.tool);

            return (
              <View key={tool.id || idx} className="flex-row">
                {/* Timeline vertical rail */}
                <View className="items-center px-1">
                  <View
                    className={`h-4 w-4 items-center justify-center rounded-full ${
                      isRunning
                        ? 'bg-primary/20'
                        : isError
                          ? 'bg-destructive/20'
                          : 'bg-success/20'
                    }`}
                  >
                    <Text
                      className={`text-[9px] font-bold ${
                        isRunning ? 'text-primary' : isError ? 'text-destructive' : 'text-success'
                      }`}
                    >
                      {isRunning ? '▶' : isError ? '✕' : '✓'}
                    </Text>
                  </View>
                  {!isLast ? <View className="my-1 w-[1.5px] flex-1 bg-border/80" /> : null}
                </View>

                {/* Step Item Content */}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDetail(tool)}
                  className="mb-2 ml-2 min-h-[34px] flex-1 rounded-xl border border-border/50 bg-surface/70 px-2.5 py-1.5 active:bg-surface active:border-border"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 flex-row items-center gap-1.5">
                      <Text className="text-xs">{icon}</Text>
                      <Text numberOfLines={1} className="font-mono text-xs font-semibold text-foreground">
                        {tool.tool}
                      </Text>
                    </View>
                    {hasDiff ? (
                      <View className="rounded bg-primary/10 px-1.5 py-0.5">
                        <Text className="text-[10px] font-bold text-primary">Diff</Text>
                      </View>
                    ) : null}
                  </View>
                  {hint ? (
                    <Text numberOfLines={1} className="mt-0.5 font-mono text-[11px] text-muted">
                      {hint}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <ToolDetailSheet tool={detail} onClose={() => setDetail(null)} />
    </View>
  );
}

