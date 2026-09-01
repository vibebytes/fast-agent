import { FlashList } from '@shopify/flash-list';
import {
  composerGate,
  countDiffStats,
  parseDiffWithLineNumbers,
  type DiffLine,
  type TranscriptEntry
} from '@fast-ide/session-view';
import { useEffect, useMemo, useRef, useState } from 'react';
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

import { bridgeStore, type FollowUpItem } from '@/bridge/store';
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

function getToolCategory(toolName: string): { icon: string; label: string } {
  const name = toolName.toLowerCase();
  if (name.includes('shell') || name.includes('bash') || name.includes('terminal') || name.includes('exec')) {
    return { icon: '⚡', label: '终端命令' };
  }
  if (name.includes('edit') || name.includes('write') || name.includes('delete') || name.includes('patch')) {
    return { icon: '📝', label: '文件变更' };
  }
  if (name.includes('read') || name.includes('grep') || name.includes('glob') || name.includes('find') || name.includes('search')) {
    return { icon: '🔍', label: '代码检索' };
  }
  if (name.includes('git')) {
    return { icon: '🌿', label: '版本管理' };
  }
  if (name.includes('agent') || name.includes('skill') || name.includes('goal')) {
    return { icon: '🤖', label: '智能体协作' };
  }
  return { icon: '⚙️', label: '系统工具' };
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
            <Text className="text-xs font-semibold text-foreground">完成</Text>
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
  const diffText = tool ? diffTextOf(tool) : undefined;
  const lines = useMemo(() => (diffText ? parseDiffWithLineNumbers(diffText) : []), [diffText]);
  const stats = countDiffStats(diffText);
  if (!tool) return null;
  const { icon, label } = getToolCategory(tool.tool);
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
            <Text className="text-xs font-semibold text-muted">代码差异对比</Text>
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
            {tool.output || toolHint(tool) || '该步骤执行完成，无额外返回。'}
          </Text>
        </View>
      )}
    </FullSheet>
  );
}

function AgentToolPipeline({ tools }: { tools: ToolLike[] }) {
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
              ? `Agent 执行流水线 · 正在处理 (${successCount + 1}/${tools.length})`
              : `执行完成 · 共 ${tools.length} 个步骤`}
          </Text>
        </View>

        <View className="flex-row items-center gap-1.5">
          {errorCount > 0 ? (
            <View className="rounded-md bg-destructive/15 px-1.5 py-0.5">
              <Text className="text-[10px] font-bold text-destructive">{errorCount} 异常</Text>
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
            {isStreaming ? '正在深度思考…' : '深度思考过程'}
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
        <Text className="text-[10px] text-muted">{copied ? '✓ 已复制' : '📋 复制'}</Text>
      </Pressable>
    </View>
  );
}

function EntryBubble({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === 'user';
  const tools = entry.tools ?? [];
  const isStreaming = entry.status === 'streaming';

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
          <Text className="text-xs text-muted">Agent 正在准备响应…</Text>
        </View>
      ) : null}

      {isStreaming && entry.text ? (
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <View className="h-3.5 w-[2px] animate-pulse rounded-full bg-primary" />
          <Text className="text-[10px] font-medium text-muted">正在生成…</Text>
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
  const gate = record ? composerGate(record.transcript, true) : null;
  const liveProcs = record?.transcript.liveProcs ?? [];
  const [interruptText, setInterruptText] = useState('');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background px-4 pt-12">
        <GlassHeader className="flex-row items-center justify-between rounded-2xl px-4 py-3">
          <Text className="text-lg font-semibold text-foreground">运行控制台</Text>
          <Pressable onPress={onClose} className="rounded-xl bg-surface px-3 py-1.5 active:opacity-75">
            <Text className="text-xs font-semibold text-foreground">关闭</Text>
          </Pressable>
        </GlassHeader>

        <View className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">当前运行状态</Text>
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
                {gate?.runState === 'running' ? '正在执行任务' : gate?.runState === 'stopping' ? '正在停止' : '空闲中'}
              </Text>
            </View>
          </View>

          {gate?.canCancel && record?.transcript.activeRunId ? (
            <Pressable
              onPress={() => bridgeStore.cancelRun(sessionId, record.transcript.activeRunId!)}
              className="mt-3.5 items-center justify-center rounded-xl bg-destructive py-2.5 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-destructive-foreground">立即中止执行</Text>
            </Pressable>
          ) : null}
        </View>

        {liveProcs.length > 0 ? (
          <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <Text className="text-sm font-semibold text-foreground">活跃后台进程 ({liveProcs.length})</Text>
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
                  <Text className="text-xs font-semibold text-destructive">终止</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <Text className="text-sm font-semibold text-foreground">即时插话与纠偏</Text>
          <TextInput
            value={interruptText}
            onChangeText={setInterruptText}
            placeholder="输入纠偏要求或新指令…"
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
            <Text className="text-sm font-semibold text-primary-foreground">打断并纠正</Text>
          </Pressable>
        </View>

        <View className="mt-3 flex-1">
          <Text className="px-1 text-sm font-semibold text-foreground">追问队列</Text>
          <View className="mt-2 flex-1">
            <FollowUpsBar sessionId={sessionId} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Composer({ sessionId }: { sessionId: string }) {
  const insets = useSafeAreaInsets();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = record ? composerGate(record.transcript, true) : null;
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

      {offline ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">未连接到桌面端，输入已锁定。请前往「设置」检查连接。</Text>
        </View>
      ) : null}

      {locked && !offline ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">请先响应上方的授权或选择选项，输入已锁定。</Text>
        </View>
      ) : null}

      {queued ? (
        <View className="flex-row items-center gap-1.5 bg-primary/10 px-4 py-1.5">
          <Text className="text-xs font-medium text-primary">已加入执行队列，将在当前轮次结束后自动触发。</Text>
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
              {gate?.runState === 'stopping' ? '正在停止执行…' : 'Agent 正在执行自主决策…'}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            {gate?.canCancel && record?.transcript.activeRunId ? (
              <Pressable
                onPress={() => bridgeStore.cancelRun(sessionId, record.transcript.activeRunId!)}
                className="rounded-lg bg-destructive/20 px-2 py-0.5 active:opacity-70"
              >
                <Text className="text-[11px] font-bold text-destructive">停止</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setRunSheet(true)}
              className="flex-row items-center gap-0.5 rounded-lg bg-surface/80 px-2 py-0.5 active:opacity-70"
            >
              <Text className="text-[11px] font-medium text-foreground">控制台</Text>
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
          placeholder={locked ? '输入已锁定' : '输入指令或消息…'}
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
            accessibilityLabel="查看运行状态"
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
              {gate?.runState === 'stopping' ? '停止中' : '运行中'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={locked || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            className="h-[44px] min-w-[54px] items-center justify-center rounded-2xl bg-default px-3.5 shadow-sm active:scale-95 active:opacity-80 disabled:opacity-30"
          >
            <Text className="text-sm font-semibold text-default-foreground">发送</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const entries = record?.transcript.entries ?? [];
  const hasMoreOlder = record?.transcript.hasMoreOlder ?? false;
  const lastResyncRef = useRef(0);

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
        renderItem={({ item }) => <EntryBubble entry={item} />}
        ListEmptyComponent={
          !record ? (
            <View className="items-center justify-center py-24">
              <View className="h-2.5 w-2.5 animate-ping rounded-full bg-primary" />
              <Text className="mt-4 text-xs text-muted">
                {snapshot.connection === 'open' ? '正在加载会话记录…' : '正在连接桌面端…'}
              </Text>
            </View>
          ) : entries.length === 0 ? (
            <View className="items-center justify-center py-24">
              <Text className="text-xs text-muted">暂无消息，发送第一条消息开始对话</Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          hasMoreOlder ? (
            <Pressable onPress={() => bridgeStore.loadOlder(sessionId)} className="items-center py-3">
              <Text className="text-xs font-medium text-primary">加载更早的历史消息…</Text>
            </Pressable>
          ) : null
        }
      />
      <ApprovalSlot sessionId={sessionId} />
      <QuestionSlot sessionId={sessionId} />
      <FollowUpsBar sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </KeyboardAvoidingView>
  );
}

function ApprovalSlot({ sessionId }: { sessionId: string }) {
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
              <Text className="text-sm font-semibold text-foreground">请求授权执行：{approval.tool}</Text>
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
            <Text className="mt-2 text-xs font-medium text-warning">风险提示：{approval.risk}</Text>
          ) : null}
          <View className="mt-3.5 flex-row gap-2.5">
            <Pressable
              onPress={() => bridgeStore.decideApproval(sessionId, approval.id, true)}
              className="flex-1 items-center justify-center rounded-xl bg-success py-2.5 shadow-sm active:scale-95"
            >
              <Text className="text-sm font-semibold text-success-foreground">批准并执行</Text>
            </Pressable>
            <Pressable
              onPress={() => bridgeStore.decideApproval(sessionId, approval.id, false)}
              className="flex-1 items-center justify-center rounded-xl bg-surface-secondary py-2.5 border border-border active:scale-95"
            >
              <Text className="text-sm font-semibold text-foreground">拒绝</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function QuestionSlot({ sessionId }: { sessionId: string }) {
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
                placeholder="输入自定义选项…"
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
                <Text className="text-sm font-semibold text-default-foreground">提交</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function FollowUpsBar({ sessionId }: { sessionId: string }) {
  const snapshot = useBridgeSnapshot();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const followUps = snapshot.followUps[sessionId];
  if (!followUps || followUps.items.length === 0) return null;
  return (
    <View className="border-t border-border bg-surface/50 px-3.5 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-muted">
          追问排队 {followUps.paused ? '（已暂停）' : ''}
        </Text>
        <Pressable onPress={() => bridgeStore.followUpPause(sessionId, !followUps.paused)}>
          <Text className="text-xs font-semibold text-primary">{followUps.paused ? '恢复执行' : '暂停队列'}</Text>
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
                <Text className="text-xs font-bold text-primary">保存</Text>
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
                <Text className="text-xs text-muted">编辑</Text>
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

