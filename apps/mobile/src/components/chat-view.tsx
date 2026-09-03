import { FlashList } from '@shopify/flash-list';
import {
  composerGate,
  countDiffStats,
  parseDiffWithLineNumbers,
  type DiffLine,
  type PendingQuestionBatch,
  type TranscriptEntry
} from '@fast-ide/session-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Clipboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  batchAnswersOf,
  batchDraftAnswered,
  batchDraftCompleted,
  emptyBatchDraft,
  overlayGoalGate,
  parseRecommendedLabel,
  STOPPABLE_GOAL_PHASES,
  type BatchDraft
} from '@/bridge/mobile-transcript';
import { bridgeStore, type FollowUpItem, type SessionRecord } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner } from '@/components/connection';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { VoiceButton } from '@/components/voice-button';
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

function getToolCategory(toolName: string): { icon: string; cat: ToolCat } {
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

function diffTextOf(tool: ToolLike): string | undefined {
  const candidate = tool.args?.diff ?? tool.args?.patch ?? tool.args?.contents;
  if (candidate && (candidate.includes('@@ -') || candidate.includes('+++') || candidate.includes('---'))) {
    return candidate;
  }
  if (tool.output && /^(diff --git |\+\+\+ |@@ -)/m.test(tool.output)) return tool.output;
  return undefined;
}

function DiffLineRow({ line }: { line: DiffLine }) {
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

function FullSheet({
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
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background pt-10">
        <GlassHeader className="flex-row items-center justify-between border-b border-border/80 px-4 pb-3">
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

function toolHint(tool: ToolLike): string {
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

function ToolDetailSheet({ tool, onClose }: { tool: ToolLike | null; onClose: () => void }) {
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
            {lines.map((line, i) => (
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

function AgentToolPipeline({ tools }: { tools: ToolLike[] }) {
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

function ReasoningBox({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [open, setOpen] = useState(false);

  return (
    <View className="mb-2.5 overflow-hidden rounded-2xl border border-border/70 bg-surface-secondary/40 shadow-xs">
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center justify-between px-3.5 py-2 active:bg-surface-secondary/70"
      >
        <View className="flex-row items-center gap-2">
          {isStreaming ? (
            <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
          ) : (
            <Glyph name="sparkles" size={13} color={vars['--muted']} />
          )}
          <Text className="text-xs font-medium text-muted">
            {isStreaming ? t('mobile.chat.thinkingLive') : t('mobile.chat.thinkingDone')}
          </Text>
        </View>
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={13} color={vars['--muted']} />
      </Pressable>
      {open ? (
        <View className="border-t border-border/40 bg-surface/60 px-3.5 py-2.5">
          <Text className="font-sans text-xs italic leading-5 text-muted" selectable>
            {reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MessageActionBar({ text }: { text?: string }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [copied, setCopied] = useState(false);

  if (!text) return null;

  const handleCopy = () => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View className="mt-2 flex-row items-center gap-3 self-start px-1">
      <Pressable
        onPress={handleCopy}
        className="flex-row items-center gap-1 rounded-lg bg-surface-secondary/70 px-2 py-1 active:opacity-75"
      >
        <Text className="text-[10px] text-muted">{copied ? t('mobile.chat.copied') : t('mobile.chat.copy')}</Text>
      </Pressable>
    </View>
  );
}

function sessionComposerGate(record: SessionRecord | undefined) {
  if (!record) return null;
  return overlayGoalGate(composerGate(record.transcript, true), record.goalCard);
}

function hasActionablePrompt(record: SessionRecord | undefined): boolean {
  const transcript = record?.transcript;
  if (!transcript) return false;
  return (
    transcript.questions.length > 0 ||
    transcript.questionBatches.length > 0 ||
    transcript.approvals.length > 0
  );
}

function StopControl({
  sessionId,
  record,
  gate,
  label,
  className,
  textClassName
}: {
  sessionId: string;
  record: SessionRecord;
  gate: ReturnType<typeof sessionComposerGate>;
  label: string;
  className: string;
  textClassName: string;
}) {
  const canStopRun = Boolean(gate?.canCancel);
  const canStopGoal = Boolean(
    !canStopRun && record.goalCard && STOPPABLE_GOAL_PHASES.has(record.goalCard.phase)
  );
  if (!canStopRun && !canStopGoal) return null;
  return (
    <Pressable
      onPress={() => {
        if (canStopRun) bridgeStore.cancelRun(sessionId, record.transcript.activeRunId);
        else bridgeStore.cancelGoal(sessionId, record.goalCard?.goalId);
      }}
      className={className}
    >
      <Text className={textClassName}>{label}</Text>
    </Pressable>
  );
}

function staleErrorEntryIds(entries: readonly TranscriptEntry[]): Set<string> {
  const stale = new Set<string>();
  let pending: string | null = null;
  for (const entry of entries) {
    if (entry.role !== 'assistant') continue;
    if (entry.status === 'error') {
      if (pending !== null) stale.add(pending);
      pending = entry.id;
    } else if (entry.status === 'done' || entry.status === 'cancelled') {
      if (pending !== null) {
        stale.add(pending);
        pending = null;
      }
    }
  }
  return stale;
}

function EntryBubble({
  entry,
  sessionId,
  busy,
  stale
}: {
  entry: TranscriptEntry;
  sessionId: string;
  busy: boolean;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const isUser = entry.role === 'user';
  const tools = entry.tools ?? [];
  const isStreaming = entry.status === 'streaming';
  const isError = entry.status === 'error';

  if (isError) {
    const rawText = (entry.text ?? '').trim();
    const firstLine = rawText.split('\n').find((line) => line.trim().length > 0);
    const summary = firstLine?.slice(0, 400) ?? '';
    const kind = entry.fault?.kind;
    const remedy = entry.fault?.remedy;
    const friendlyHint =
      kind === 'transport' || kind === 'availability' || kind === 'config'
        ? t(`errors.hint.${kind}`, { defaultValue: '' })
        : '';
    const primary = friendlyHint || summary;
    const retryable = entry.fault ? entry.fault.remedy === 'retry_same' : true;
    const runId = entry.turnId?.trim();
    return (
      <View className="mb-5 self-stretch overflow-hidden rounded-2xl border border-destructive/40 bg-destructive/10 px-3.5 py-3">
        <Text className="text-sm font-semibold text-destructive">{t('session.errorCard.title')}</Text>
        {kind ? (
          <Text className="mt-1 text-xs text-muted">
            {t('session.errorCard.kind')}: {t(`errors.kind.${kind}`, { defaultValue: kind })}
          </Text>
        ) : null}
        {primary ? (
          <Text className="mt-1.5 font-mono text-xs leading-5 text-foreground" selectable>
            {primary}
          </Text>
        ) : null}
        {remedy ? (
          <Text className="mt-2 text-xs font-medium text-warning">
            {t('session.errorCard.remedy')}: {t(`errors.remedy.${remedy}`, { defaultValue: remedy })}
          </Text>
        ) : null}
        {typeof entry.fault?.attempts === 'number' && entry.fault.attempts > 1 ? (
          <Text className="mt-1 text-[11px] text-muted">
            {t('session.errorCard.attempts', { attempts: entry.fault.attempts })}
          </Text>
        ) : null}
        {stale ? null : (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {retryable && runId ? (
              <Pressable
                disabled={busy}
                onPress={() => bridgeStore.rerunRun(sessionId, runId)}
                className="rounded-lg border border-destructive/40 bg-background px-3 py-1.5 active:opacity-75 disabled:opacity-30"
              >
                <Text className="text-xs font-medium text-foreground">{t('session.errorCard.retry')}</Text>
              </Pressable>
            ) : null}
            {typeof entry.fault?.acceptedTurns === 'number' && entry.fault.acceptedTurns > 0 ? (
              <Pressable
                disabled={busy}
                onPress={() => bridgeStore.continueRun(sessionId)}
                className="rounded-lg border border-destructive/40 bg-background px-3 py-1.5 active:opacity-75 disabled:opacity-30"
              >
                <Text className="text-xs font-medium text-foreground">{t('session.errorCard.continue')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <AgentToolPipeline tools={tools} />
      </View>
    );
  }

  return (
    <View
      className={
        isUser
          ? 'mb-4 max-w-[85%] self-end rounded-2xl rounded-tr-xs bg-default px-4 py-3 shadow-xs active:scale-[0.99]'
          : 'mb-5 self-stretch px-1'
      }
    >
      {/* Agent Thinking Box */}
      {entry.reasoning ? (
        <ReasoningBox reasoning={entry.reasoning} isStreaming={isStreaming && !entry.text} />
      ) : null}

      {/* Main Content */}
      {entry.text ? (
        <Text
          className={
            isUser
              ? 'text-[15px] font-normal leading-6 text-default-foreground'
              : 'text-[15px] font-normal leading-7 text-foreground'
          }
          selectable
        >
          {entry.text}
        </Text>
      ) : null}

      {/* Streaming pulse placeholder */}
      {isStreaming && !entry.text && tools.length === 0 && !entry.reasoning ? (
        <View className="flex-row items-center gap-2 py-1">
          <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
          <Text className="text-xs text-muted">{t('mobile.chat.preparing')}</Text>
        </View>
      ) : null}

      {isStreaming && entry.text ? (
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <View className="h-3.5 w-[2px] animate-pulse rounded-full bg-primary" />
          <Text className="text-[10px] font-medium text-muted">{t('mobile.chat.generating')}</Text>
        </View>
      ) : null}

      {/* Agent Tool Calling Pipeline */}
      <AgentToolPipeline tools={tools} />

      {/* Action Bar for Assistant */}
      {!isUser && entry.text ? <MessageActionBar text={entry.text} /> : null}
    </View>
  );
}

function RunSheet({
  sessionId,
  visible,
  onClose
}: {
  sessionId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record);
  const liveProcs = record?.transcript.liveProcs ?? [];
  const [interruptText, setInterruptText] = useState('');
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background px-4 pt-12">
        <GlassHeader className="flex-row items-center justify-between rounded-2xl px-4 py-3">
          <Text className="text-lg font-semibold text-foreground">{t('mobile.chat.consoleTitle')}</Text>
          <Pressable onPress={onClose} className="rounded-xl bg-surface px-3 py-1.5 active:opacity-75">
            <Text className="text-xs font-semibold text-foreground">{t('shell.common.close')}</Text>
          </Pressable>
        </GlassHeader>

        <View className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.runStatus')}</Text>
            <View className="flex-row items-center gap-1.5">
              <View
                className={`h-2.5 w-2.5 rounded-full ${
                  gate?.runState === 'running'
                    ? 'bg-primary animate-pulse'
                    : gate?.runState === 'stopping'
                      ? 'bg-warning'
                      : 'bg-muted'
                }`}
              />
              <Text className="text-xs font-medium text-muted">
                {gate?.runState === 'running'
                  ? t('mobile.chat.runRunning')
                  : gate?.runState === 'stopping'
                    ? t('mobile.chat.runStopping')
                    : t('mobile.chat.runIdle')}
              </Text>
            </View>
          </View>

          {record ? (
            <StopControl
              sessionId={sessionId}
              record={record}
              gate={gate}
              label={t('mobile.chat.abortNow')}
              className="mt-3.5 items-center justify-center rounded-xl bg-destructive py-2.5 active:opacity-80"
              textClassName="text-sm font-semibold text-destructive-foreground"
            />
          ) : null}
        </View>

        {liveProcs.length > 0 ? (
          <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.liveProcs', { count: liveProcs.length })}</Text>
            {liveProcs.map((proc) => (
              <View
                key={proc.procId}
                className="mt-2.5 flex-row items-center justify-between rounded-xl bg-surface-secondary px-3 py-2"
              >
                <Text numberOfLines={1} className="flex-1 font-mono text-xs text-foreground">
                  {proc.command}
                </Text>
                <Pressable
                  onPress={() => bridgeStore.killProc(sessionId, proc.procId)}
                  className="ml-2 rounded-lg bg-destructive/15 px-2.5 py-1 active:opacity-75"
                >
                  <Text className="text-xs font-semibold text-destructive">{t('mobile.chat.kill')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.interruptTitle')}</Text>
          <TextInput
            value={interruptText}
            onChangeText={setInterruptText}
            placeholder={t('mobile.chat.interruptPlaceholder')}
            placeholderTextColor={vars['--muted']}
            multiline
            className="mt-2.5 min-h-[72px] rounded-xl border border-border bg-surface-secondary px-3.5 py-2.5 text-sm text-foreground"
          />
          <Pressable
            onPress={() => {
              if (!interruptText.trim()) return;
              bridgeStore.interruptAndSay(sessionId, interruptText.trim());
              setInterruptText('');
              onClose();
            }}
            disabled={!interruptText.trim()}
            className="mt-3 items-center justify-center rounded-xl bg-primary py-2.5 active:opacity-80 disabled:opacity-40"
          >
            <Text className="text-sm font-semibold text-primary-foreground">{t('mobile.chat.interruptSubmit')}</Text>
          </Pressable>
        </View>

        <View className="mt-3 flex-1">
          <Text className="px-1 text-sm font-semibold text-foreground">{t('mobile.chat.followUpTitle')}</Text>
          <View className="mt-2 flex-1">
            <FollowUpsBar sessionId={sessionId} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Composer({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record);
  const [text, setText] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [runSheet, setRunSheet] = useState(false);

  const submit = () => {
    const value = text.trim();
    if (!value || gate?.composerLocked) return;
    const hasUserTurn = (record?.transcript.entries ?? []).some((entry) => entry.role === 'user');
    const result = bridgeStore.sendUserMessage(sessionId, value, {
      clientMessageId: pendingId ?? undefined,
      generateTitle: !hasUserTurn
    });
    if (result.sent) {
      setPendingId(result.clientMessageId);
      setText('');
      if (gate?.canEnqueue) {
        setQueued(true);
        setTimeout(() => setQueued(false), 2000);
      }
    }
  };

  const handleVoiceSend = (voiceText: string) => {
    if (!voiceText.trim() || gate?.composerLocked) return;
    const hasUserTurn = (record?.transcript.entries ?? []).some((entry) => entry.role === 'user');
    const result = bridgeStore.sendUserMessage(sessionId, voiceText.trim(), {
      generateTitle: !hasUserTurn
    });
    if (result.sent && gate?.canEnqueue) {
      setQueued(true);
      setTimeout(() => setQueued(false), 2000);
    }
  };

  const locked = (gate?.composerLocked ?? false) || snapshot.connection !== 'open';
  const offline = snapshot.connection !== 'open';
  const running = gate?.runState === 'running' || gate?.runState === 'stopping';

  return (
    <View className="border-t border-border bg-background">
      <RunSheet sessionId={sessionId} visible={runSheet} onClose={() => setRunSheet(false)} />

      {snapshot.leaseNotice ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">
            {snapshot.leaseNotice.startsWith('errors.') || snapshot.leaseNotice.startsWith('shell.')
              ? t(snapshot.leaseNotice)
              : snapshot.leaseNotice}
          </Text>
        </View>
      ) : null}

      {offline ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">{t('mobile.chat.lockedDisconnected')}</Text>
        </View>
      ) : null}

      {locked && !offline && !hasActionablePrompt(record) ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">{t('mobile.chat.lockedDecision')}</Text>
        </View>
      ) : null}

      {queued ? (
        <View className="flex-row items-center gap-1.5 bg-primary/10 px-4 py-1.5">
          <Text className="text-xs font-medium text-primary">{t('mobile.chat.queued')}</Text>
        </View>
      ) : null}

      {running ? (
        <View className="mx-3 mt-2 flex-row items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2">
          <Pressable
            onPress={() => setRunSheet(true)}
            className="flex-1 flex-row items-center gap-2"
          >
            <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
            <Text className="text-xs font-semibold text-primary">
              {gate?.runState === 'stopping' ? t('mobile.chat.agentStopping') : t('mobile.chat.agentRunning')}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            {record ? (
              <StopControl
                sessionId={sessionId}
                record={record}
                gate={gate}
                label={t('shell.common.stop')}
                className="rounded-lg bg-destructive/20 px-2 py-0.5 active:opacity-70"
                textClassName="text-[11px] font-bold text-destructive"
              />
            ) : null}
            <Pressable
              onPress={() => setRunSheet(true)}
              className="flex-row items-center gap-0.5 rounded-lg bg-surface/80 px-2 py-0.5 active:opacity-70"
            >
              <Text className="text-[11px] font-medium text-foreground">{t('mobile.chat.console')}</Text>
              <Glyph name="chevron-right" size={10} color={vars['--foreground']} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Floating Island Style Input Bar */}
      <View
        style={{ paddingBottom: Math.max(12, insets.bottom) }}
        className="flex-row items-end gap-2.5 px-3.5 pt-2.5"
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={locked ? t('mobile.chat.placeholderLocked') : t('mobile.chat.placeholder')}
          placeholderTextColor={vars['--muted']}
          editable={!locked}
          multiline
          className="max-h-28 min-h-[44px] flex-1 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm leading-5 text-foreground shadow-sm"
        />

        <VoiceButton onSend={handleVoiceSend} disabled={locked} />

        {running && !text.trim() ? (
          <Pressable
            onPress={() => setRunSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.runA11y')}
            className={`h-[44px] min-w-[54px] flex-row items-center justify-center gap-1.5 rounded-2xl border px-3.5 shadow-sm active:scale-95 ${
              gate?.runState === 'stopping'
                ? 'border-warning/40 bg-warning/10'
                : 'border-primary/40 bg-primary/10'
            }`}
          >
            <View
              className={`h-2 w-2 animate-ping rounded-full ${
                gate?.runState === 'stopping' ? 'bg-warning' : 'bg-primary'
              }`}
            />
            <Text
              className={`text-xs font-semibold ${
                gate?.runState === 'stopping' ? 'text-warning' : 'text-primary'
              }`}
            >
              {gate?.runState === 'stopping' ? t('mobile.chat.stopping') : t('mobile.chat.running')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={locked || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.sendA11y')}
            className="h-[44px] min-w-[54px] items-center justify-center rounded-2xl bg-default px-3.5 shadow-sm active:scale-95 active:opacity-80 disabled:opacity-30"
          >
            <Text className="text-sm font-semibold text-default-foreground">{t('shell.common.send')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const entries = record?.transcript.entries ?? [];
  const hasMoreOlder = record?.transcript.hasMoreOlder ?? false;
  const lastResyncRef = useRef(0);
  const staleIds = useMemo(() => staleErrorEntryIds(entries), [entries]);
  const gate = sessionComposerGate(record);
  const busy = gate?.runState === 'running' || gate?.runState === 'stopping';

  const maybeResync = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom > 150) return;
    const now = Date.now();
    if (now - lastResyncRef.current < 3000) return;
    lastResyncRef.current = now;
    bridgeStore.resyncSession(sessionId);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      className="flex-1 bg-background"
    >
      <ConnectionBanner />
      <FlashList
        data={entries}
        keyExtractor={(entry) => entry.id}
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 100 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
        onScrollEndDrag={maybeResync}
        onMomentumScrollEnd={maybeResync}
        renderItem={({ item }) => (
          <EntryBubble entry={item} sessionId={sessionId} busy={busy} stale={staleIds.has(item.id)} />
        )}
        ListEmptyComponent={
          !record ? (
            <View className="items-center justify-center py-24">
              <View className="h-2.5 w-2.5 animate-ping rounded-full bg-primary" />
              <Text className="mt-4 text-xs text-muted">
                {snapshot.connection === 'open' ? t('mobile.chat.loadingTranscript') : t('mobile.chat.connectingDesktop')}
              </Text>
            </View>
          ) : entries.length === 0 ? (
            <View className="items-center justify-center py-24">
              <Text className="text-xs text-muted">{t('mobile.chat.emptyMessages')}</Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          hasMoreOlder ? (
            <Pressable onPress={() => bridgeStore.loadOlder(sessionId)} className="items-center py-3">
              <Text className="text-xs font-medium text-primary">{t('mobile.chat.loadOlder')}</Text>
            </Pressable>
          ) : null
        }
      />
      <ApprovalSlot sessionId={sessionId} />
      <QuestionBatchSlot sessionId={sessionId} />
      <QuestionSlot sessionId={sessionId} />
      <FollowUpsBar sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </KeyboardAvoidingView>
  );
}

function ApprovalSlot({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const approvals = snapshot.records[sessionId]?.transcript.approvals ?? [];
  if (approvals.length === 0) return null;
  return (
    <View className="gap-2.5 px-3.5 pb-2">
      {approvals.map((approval, index) => (
        <View
          key={approval.id}
          className="overflow-hidden rounded-2xl border border-warning/50 bg-surface p-4 shadow-md"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-2.5 w-2.5 rounded-full bg-warning" />
              <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.approvalTitle', { tool: approval.tool })}</Text>
            </View>
            {approvals.length > 1 ? (
              <Text className="text-xs font-mono text-warning">
                {index + 1}/{approvals.length}
              </Text>
            ) : null}
          </View>
          {approval.description ? (
            <Text className="mt-2 text-xs leading-5 text-muted" numberOfLines={6}>
              {approval.description}
            </Text>
          ) : null}
          {approval.risk ? (
            <Text className="mt-2 text-xs font-medium text-warning">{t('mobile.chat.approvalRisk', { risk: approval.risk })}</Text>
          ) : null}
          <View className="mt-3.5 flex-row gap-2.5">
            <Pressable
              onPress={() => bridgeStore.decideApproval(sessionId, approval.id, true)}
              className="flex-1 items-center justify-center rounded-xl bg-success py-2.5 shadow-sm active:scale-95"
            >
              <Text className="text-sm font-semibold text-success-foreground">{t('mobile.chat.approve')}</Text>
            </Pressable>
            <Pressable
              onPress={() => bridgeStore.decideApproval(sessionId, approval.id, false)}
              className="flex-1 items-center justify-center rounded-xl bg-surface-secondary py-2.5 border border-border active:scale-95"
            >
              <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.deny')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function QuestionBatchSlot({ sessionId }: { sessionId: string }) {
  const snapshot = useBridgeSnapshot();
  const batches = snapshot.records[sessionId]?.transcript.questionBatches ?? [];
  if (batches.length === 0) return null;
  return (
    <View className="gap-2.5 px-3.5 pb-2">
      {batches.map((batch) => (
        <QuestionBatchPane key={batch.rpcId} sessionId={sessionId} batch={batch} />
      ))}
    </View>
  );
}

function QuestionBatchPane({
  sessionId,
  batch
}: {
  sessionId: string;
  batch: PendingQuestionBatch;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, BatchDraft>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(0);
    setDrafts({});
    setError(null);
  }, [batch.rpcId]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, batch.questions.length - 1)));
  }, [batch.questions.length]);

  const last = batch.questions.length - 1;
  const question = batch.questions[index];
  if (!question) return null;
  const draft = drafts[question.id] ?? emptyBatchDraft();
  const multi = Boolean(question.multiSelect);
  const options = question.options ?? [];
  const approve = question.intent?.kind === 'plan-review' ? question.intent.approve : undefined;

  const update = (next: BatchDraft) => {
    setDrafts((cur) => ({ ...cur, [question.id]: next }));
    setError(null);
  };

  const choose = (label: string) => {
    if (multi) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((s) => s !== label)
        : [...draft.selected, label];
      update({ ...draft, selected, skipped: false });
      return;
    }
    update({ selected: [label], custom: '', skipped: false });
    if (index < last) setIndex(index + 1);
  };

  const submit = (map: Record<string, BatchDraft>) => {
    const missing = batch.questions.findIndex((q) => !batchDraftCompleted(map[q.id] ?? emptyBatchDraft()));
    if (missing >= 0) {
      setIndex(missing);
      setError(t('shell.question.incomplete'));
      return;
    }
    bridgeStore.answerQuestionBatch(sessionId, batch.rpcId, { answers: batchAnswersOf(batch.questions, map) });
  };

  const skip = () => {
    const nextDrafts = { ...drafts, [question.id]: { selected: [], custom: '', skipped: true } };
    setDrafts(nextDrafts);
    setError(null);
    if (index < last) {
      setIndex(index + 1);
      return;
    }
    submit(nextDrafts);
  };

  const goNext = () => {
    if (!batchDraftAnswered(draft)) {
      setError(t('shell.question.unanswered'));
      return;
    }
    if (index < last) {
      setIndex(index + 1);
      setError(null);
      return;
    }
    submit(drafts);
  };

  return (
    <View className="overflow-hidden rounded-2xl border border-primary/40 bg-surface p-4 shadow-md">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          {question.header ? (
            <Text className="text-[11px] leading-4 text-muted">{question.header}</Text>
          ) : null}
          <Text className="text-base font-semibold text-foreground">{question.question}</Text>
        </View>
        <Pressable
          onPress={() => bridgeStore.answerQuestionBatch(sessionId, batch.rpcId, { cancelled: true })}
          className="rounded-lg px-2 py-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-muted">{t('shell.question.dismissAll')}</Text>
        </Pressable>
      </View>
      {question.detail ? (
        <Text className="mt-1.5 text-xs leading-5 text-muted">{question.detail}</Text>
      ) : null}
      <View className="mt-3 gap-2">
        {options.map((option, i) => {
          const on = draft.selected.includes(option.label);
          const display = parseRecommendedLabel(option.label);
          const recommended = display.recommended || approve === option.label;
          return (
            <Pressable
              key={`${option.label}-${i}`}
              onPress={() => choose(option.label)}
              className={`rounded-xl border px-3.5 py-2.5 active:scale-[0.98] ${
                on ? 'border-primary bg-primary/10' : 'border-border bg-surface-secondary'
              }`}
            >
              <View className="flex-row items-start gap-2">
                <Text className="mt-0.5 text-xs font-mono text-muted">{multi ? (on ? '☑' : '☐') : `${i + 1}`}</Text>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-foreground">{display.label}</Text>
                  {recommended ? (
                    <Text className="mt-0.5 text-[10px] font-semibold text-primary">
                      {t('shell.question.recommended')}
                    </Text>
                  ) : null}
                  {option.description ? (
                    <Text className="mt-0.5 text-xs leading-4 text-muted">{option.description}</Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="mt-3 flex-row gap-2">
        <TextInput
          value={draft.custom}
          onChangeText={(custom) =>
            update({
              selected: multi ? draft.selected : [],
              custom,
              skipped: false
            })
          }
          placeholder={t('shell.question.typeYourAnswer')}
          placeholderTextColor={vars['--muted']}
          className="flex-1 rounded-xl border border-border bg-surface-secondary px-3.5 py-2 text-sm text-foreground"
        />
      </View>
      {error ? <Text className="mt-2 text-xs text-destructive">{error}</Text> : null}
      <View className="mt-3.5 flex-row items-center justify-between">
        <Text className="text-xs text-muted">
          {index + 1} / {batch.questions.length}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={skip}
            className="rounded-xl border border-border bg-surface-secondary px-3 py-2 active:scale-95"
          >
            <Text className="text-xs font-semibold text-foreground">{t('shell.question.skip')}</Text>
          </Pressable>
          <Pressable
            onPress={goNext}
            disabled={!batchDraftAnswered(draft)}
            className="rounded-xl bg-default px-3 py-2 active:scale-95 disabled:opacity-30"
          >
            <Text className="text-xs font-semibold text-default-foreground">
              {index === last ? t('shell.question.submit') : t('shell.question.next')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function QuestionSlot({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const [custom, setCustom] = useState('');
  const questions = snapshot.records[sessionId]?.transcript.questions ?? [];
  if (questions.length === 0) return null;
  return (
    <View className="gap-2.5 px-3.5 pb-2">
      {questions.map((question) => (
        <View
          key={question.id}
          className="overflow-hidden rounded-2xl border border-primary/40 bg-surface p-4 shadow-md"
        >
          {question.title ? (
            <Text className="text-base font-semibold text-foreground">{question.title}</Text>
          ) : null}
          <Text className="mt-1.5 text-sm leading-5 text-foreground">{question.question}</Text>
          <View className="mt-3 gap-2">
            {question.options.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => bridgeStore.answerQuestion(sessionId, question.id, option.label)}
                className="rounded-xl border border-border bg-surface-secondary px-3.5 py-2.5 active:scale-[0.98] active:bg-surface"
              >
                <Text className="text-sm font-medium text-foreground">{option.label}</Text>
                {option.description ? (
                  <Text className="mt-0.5 text-xs text-muted leading-4">{option.description}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
          {question.allowCustom ? (
            <View className="mt-3 flex-row gap-2">
              <TextInput
                value={custom}
                onChangeText={setCustom}
                placeholder={t('mobile.chat.customOption')}
                placeholderTextColor={vars['--muted']}
                className="flex-1 rounded-xl border border-border bg-surface-secondary px-3.5 py-2 text-sm text-foreground"
              />
              <Pressable
                onPress={() => {
                  if (!custom.trim()) return;
                  bridgeStore.answerQuestion(sessionId, question.id, custom.trim());
                  setCustom('');
                }}
                className="items-center justify-center rounded-xl bg-default px-4 active:scale-95"
              >
                <Text className="text-sm font-semibold text-default-foreground">{t('shell.common.submit')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function FollowUpsBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const followUps = snapshot.followUps[sessionId];
  if (!followUps || followUps.items.length === 0) return null;
  return (
    <View className="border-t border-border bg-surface/50 px-3.5 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-muted">
          {followUps.paused ? t('mobile.chat.queuePaused') : t('mobile.chat.queueActive')}
        </Text>
        <Pressable onPress={() => bridgeStore.followUpPause(sessionId, !followUps.paused)}>
          <Text className="text-xs font-semibold text-primary">{followUps.paused ? t('mobile.chat.resumeQueue') : t('mobile.chat.pauseQueue')}</Text>
        </Pressable>
      </View>
      {followUps.items.map((item: FollowUpItem, index: number) => (
        <View
          key={item.id}
          className="mt-2 flex-row items-center rounded-xl border border-border bg-surface px-3 py-2"
        >
          {editingId === item.id ? (
            <View className="flex-1 flex-row items-center gap-2">
              <TextInput
                value={editText}
                onChangeText={setEditText}
                autoFocus
                className="flex-1 rounded-lg bg-surface-secondary px-2.5 py-1 text-xs text-foreground"
              />
              <Pressable
                onPress={() => {
                  if (editText.trim()) bridgeStore.followUpUpdate(sessionId, item.id, editText.trim());
                  setEditingId(null);
                }}
              >
                <Text className="text-xs font-bold text-primary">{t('shell.common.save')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                className="flex-1"
                onPress={() => bridgeStore.followUpReorder(sessionId, index, 0)}
                onLongPress={() => {
                  setEditText(item.text);
                  setEditingId(item.id);
                }}
              >
                <Text numberOfLines={1} className="text-xs font-medium text-foreground">
                  {index + 1}. {item.text}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setEditText(item.text);
                  setEditingId(item.id);
                }}
                className="ml-2 px-1.5 py-0.5"
              >
                <Text className="text-xs text-muted">{t('mobile.chat.edit')}</Text>
              </Pressable>
              <Pressable onPress={() => bridgeStore.followUpRemove(sessionId, item.id)} className="ml-1 px-1.5 py-0.5">
                <Text className="text-xs text-muted">✕</Text>
              </Pressable>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

