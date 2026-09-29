import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  buildApprovalViewModel,
  type ApprovalTitle,
  type PendingQuestion,
  type PendingQuestionBatch
} from '@fast-ide/session-view';
import {
  batchAnswersOf,
  batchDraftAnswered,
  batchDraftCompleted,
  emptyBatchDraft,
  parseRecommendedLabel,
  type BatchDraft
} from '@/bridge/mobile-transcript';
import { bridgeStore, type FollowUpItem } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

type T = ReturnType<typeof useTranslation>['t'];

const CARD = 'rounded-2xl border border-black/[0.04] bg-surface p-4 shadow-md dark:border-white/10 dark:border-t-white/20';
const PRIMARY_BTN =
  'min-h-11 flex-1 items-center justify-center rounded-xl border border-transparent bg-default active:opacity-80 disabled:opacity-30 dark:border-t-white/25';
const SECONDARY_BTN =
  'min-h-11 flex-1 items-center justify-center rounded-xl border border-black/[0.04] bg-surface-secondary active:opacity-70 dark:border-white/10';
const SWIPE = 48;

function approvalTitle(t: T, title: ApprovalTitle): string {
  if (title.kind === 'subagent' && title.name) return t('session.approval.title.subagentNamed', { name: title.name });
  if (title.kind === 'mcp_tool' && title.server && title.tool) {
    return t('session.approval.title.mcp_toolQualified', { server: title.server, tool: title.tool });
  }
  if (title.kind === 'mcp_tool' && title.tool) return t('session.approval.title.mcp_toolNamed', { tool: title.tool });
  if (title.kind === 'tool') return t('session.approval.title.tool', { tool: title.tool });
  return t(`session.approval.title.${title.kind}`);
}

/** Cycles through several cards: swipe sideways, or tap the counter. */
function Pager({
  index,
  count,
  onMove,
  label,
  children
}: {
  index: number;
  count: number;
  onMove: (next: number) => void;
  label: string;
  children: ReactNode;
}) {
  const startX = useRef<number | null>(null);
  const move = (step: number) => onMove((index + step + count) % count);
  return (
    <View
      className="px-4 pb-2"
      onTouchStart={(e) => {
        startX.current = e.nativeEvent.pageX;
      }}
      onTouchEnd={(e) => {
        if (startX.current == null || count < 2) return;
        const dx = e.nativeEvent.pageX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > SWIPE) move(dx < 0 ? 1 : -1);
      }}
    >
      <View className={CARD}>
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] text-muted">{label}</Text>
          {count > 1 ? (
            <Pressable onPress={() => move(1)} hitSlop={12} className="min-h-6 justify-center active:opacity-60">
              <Text className="font-mono text-[13px] text-muted">
                {index + 1}/{count}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {children}
      </View>
    </View>
  );
}

export function ApprovalSlot({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const approvals = snapshot.records[sessionId]?.transcript.approvals ?? [];
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState(false);
  if (approvals.length === 0) return null;
  const index = Math.min(cursor, approvals.length - 1);
  const approval = approvals[index];
  if (!approval) return null;
  const view = buildApprovalViewModel(approval);
  const dangerous = view.riskBadge === 'destructive' || view.riskBadge === 'unsandboxed';
  const subject = view.subject.trim();

  return (
    <Pager
      index={index}
      count={approvals.length}
      onMove={(next) => {
        setCursor(next);
        setExpanded(false);
      }}
      label={t('mobile.chat.approvalLabel')}
    >
      <Text className="mt-1 text-[15px] font-semibold leading-6 text-surface-foreground">
        {approvalTitle(t, view.title)}
      </Text>
      {subject ? (
        <Pressable onPress={() => setExpanded((v) => !v)} className="mt-1.5 active:opacity-70">
          <Text numberOfLines={expanded ? undefined : 3} className="font-mono text-[13px] leading-5 text-surface-foreground" selectable={expanded}>
            {subject}
          </Text>
        </Pressable>
      ) : null}
      {view.secondary ? (
        <Text numberOfLines={expanded ? undefined : 2} className="mt-1 font-mono text-[13px] leading-5 text-muted">
          {view.secondary}
        </Text>
      ) : null}
      <View className="mt-4 flex-row gap-2.5">
        <Pressable
          onPress={() => bridgeStore.decideApproval(sessionId, approval.id, false)}
          className={SECONDARY_BTN}
        >
          <Text className="text-[15px] font-semibold text-surface-secondary-foreground">{t('mobile.chat.deny')}</Text>
        </Pressable>
        <Pressable
          onPress={() => bridgeStore.decideApproval(sessionId, approval.id, true)}
          className={dangerous ? PRIMARY_BTN.replace('bg-default', 'bg-danger') : PRIMARY_BTN}
        >
          <Text className={`text-[15px] font-semibold ${dangerous ? 'text-danger-foreground' : 'text-default-foreground'}`}>
            {t('mobile.chat.approve')}
          </Text>
        </Pressable>
      </View>
    </Pager>
  );
}

export function QuestionBatchSlot({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const batches = snapshot.records[sessionId]?.transcript.questionBatches ?? [];
  const [cursor, setCursor] = useState(0);
  if (batches.length === 0) return null;
  const index = Math.min(cursor, batches.length - 1);
  const batch = batches[index];
  if (!batch) return null;
  return (
    <Pager index={index} count={batches.length} onMove={setCursor} label={t('mobile.chat.questionLabel')}>
      <QuestionBatchPane key={batch.rpcId} sessionId={sessionId} batch={batch} />
    </Pager>
  );
}

function Option({
  on,
  mark,
  label,
  recommended,
  description,
  onPress
}: {
  on: boolean;
  mark: ReactNode;
  label: string;
  recommended?: boolean;
  description?: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-11 justify-center rounded-xl border-2 bg-surface-secondary px-3.5 py-2.5 active:opacity-70 ${
        on ? 'border-focus' : 'border-black/[0.04] dark:border-white/10'
      }`}
    >
      <View className="flex-row items-start gap-2.5">
        <View className="w-4 pt-1">{mark}</View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] text-surface-secondary-foreground">{label}</Text>
          {recommended ? (
            <Text className="mt-0.5 text-[11px] font-semibold text-link">{t('shell.question.recommended')}</Text>
          ) : null}
          {description ? <Text className="mt-0.5 text-[13px] leading-5 text-muted">{description}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function QuestionBatchPane({ sessionId, batch }: { sessionId: string; batch: PendingQuestionBatch }) {
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
    <View>
      <View className="mt-1 flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          {question.header ? <Text className="text-[11px] leading-4 text-muted">{question.header}</Text> : null}
          <Text className="text-[15px] font-semibold leading-6 text-surface-foreground">{question.question}</Text>
        </View>
        <Pressable
          onPress={() => bridgeStore.answerQuestionBatch(sessionId, batch.rpcId, { cancelled: true })}
          className="min-h-11 justify-center px-1 active:opacity-60"
        >
          <Text className="text-[13px] font-semibold text-muted">{t('shell.question.dismissAll')}</Text>
        </Pressable>
      </View>
      {question.detail ? <Text className="mt-1 text-[13px] leading-5 text-muted">{question.detail}</Text> : null}
      <View className="mt-3 gap-2">
        {options.map((option, i) => {
          const on = draft.selected.includes(option.label);
          const display = parseRecommendedLabel(option.label);
          return (
            <Option
              key={`${option.label}-${i}`}
              on={on}
              mark={
                multi ? (
                  on ? (
                    <Glyph name="check" size={14} color={vars['--focus']} />
                  ) : null
                ) : (
                  <Text className="font-mono text-[13px] text-muted">{i + 1}</Text>
                )
              }
              label={display.label}
              recommended={display.recommended || approve === option.label}
              description={option.description}
              onPress={() => choose(option.label)}
            />
          );
        })}
      </View>
      <TextInput
        value={draft.custom}
        onChangeText={(custom) => update({ selected: multi ? draft.selected : [], custom, skipped: false })}
        placeholder={t('shell.question.typeYourAnswer')}
        placeholderTextColor={vars['--muted']}
        className="mt-3 min-h-11 rounded-xl bg-surface-secondary px-3.5 py-2.5 text-[15px] text-surface-secondary-foreground"
      />
      {error ? <Text className="mt-2 text-[13px] text-danger">{error}</Text> : null}
      <View className="mt-4 flex-row items-center gap-2.5">
        <Text className="text-[13px] text-muted">
          {index + 1} / {batch.questions.length}
        </Text>
        <Pressable onPress={skip} className={SECONDARY_BTN}>
          <Text className="text-[15px] font-semibold text-surface-secondary-foreground">{t('shell.question.skip')}</Text>
        </Pressable>
        <Pressable onPress={goNext} disabled={!batchDraftAnswered(draft)} className={PRIMARY_BTN}>
          <Text className="text-[15px] font-semibold text-default-foreground">
            {index === last ? t('shell.question.submit') : t('shell.question.next')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function QuestionSlot({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const questions = snapshot.records[sessionId]?.transcript.questions ?? [];
  const [cursor, setCursor] = useState(0);
  if (questions.length === 0) return null;
  const index = Math.min(cursor, questions.length - 1);
  const question = questions[index];
  if (!question) return null;
  return (
    <Pager index={index} count={questions.length} onMove={setCursor} label={t('mobile.chat.questionLabel')}>
      <QuestionCard key={question.id} sessionId={sessionId} question={question} />
    </Pager>
  );
}

export function QuestionCard({ sessionId, question }: { sessionId: string; question: PendingQuestion }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [custom, setCustom] = useState('');
  return (
    <View>
      {question.title ? (
        <Text className="mt-1 text-[15px] font-semibold leading-6 text-surface-foreground">{question.title}</Text>
      ) : null}
      <Text className="mt-1 text-[15px] leading-6 text-surface-foreground">{question.question}</Text>
      <View className="mt-3 gap-2">
        {question.options.map((option, i) => (
          <Option
            key={option.id}
            on={false}
            mark={<Text className="font-mono text-[13px] text-muted">{i + 1}</Text>}
            label={option.label}
            description={option.description}
            onPress={() => bridgeStore.answerQuestion(sessionId, question.id, option.label)}
          />
        ))}
      </View>
      {question.allowCustom ? (
        <View className="mt-3 flex-row gap-2">
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder={t('mobile.chat.customOption')}
            placeholderTextColor={vars['--muted']}
            className="min-h-11 flex-1 rounded-xl bg-surface-secondary px-3.5 py-2.5 text-[15px] text-surface-secondary-foreground"
          />
          <Pressable
            onPress={() => {
              if (!custom.trim()) return;
              bridgeStore.answerQuestion(sessionId, question.id, custom.trim());
              setCustom('');
            }}
            className="min-h-11 items-center justify-center rounded-xl bg-default px-4 active:opacity-80"
          >
            <Text className="text-[15px] font-semibold text-default-foreground">{t('shell.common.submit')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function FollowUpsBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const followUps = snapshot.followUps[sessionId];
  if (!followUps || followUps.items.length === 0) return null;
  return (
    <View>
      <View className="flex-row items-center justify-between pt-5">
        <Text className="text-[13px] text-muted">
          {followUps.paused ? t('mobile.chat.queuePaused') : t('mobile.chat.queueActive')}
        </Text>
        <Pressable
          onPress={() => bridgeStore.followUpPause(sessionId, !followUps.paused)}
          className="min-h-11 justify-center pl-3 active:opacity-60"
        >
          <Text className="text-[13px] font-semibold text-link">
            {followUps.paused ? t('mobile.chat.resumeQueue') : t('mobile.chat.pauseQueue')}
          </Text>
        </Pressable>
      </View>
      {followUps.items.map((item: FollowUpItem, index: number) => (
        <View key={item.id} className="min-h-11 flex-row items-center">
          {editingId === item.id ? (
            <View className="flex-1 flex-row items-center gap-2">
              <TextInput
                value={editText}
                onChangeText={setEditText}
                autoFocus
                className="min-h-10 flex-1 rounded-xl bg-surface-secondary px-3 text-[15px] text-surface-secondary-foreground"
              />
              <Pressable
                onPress={() => {
                  if (editText.trim()) bridgeStore.followUpUpdate(sessionId, item.id, editText.trim());
                  setEditingId(null);
                }}
                className="min-h-11 justify-center px-2 active:opacity-60"
              >
                <Text className="text-[15px] font-semibold text-link">{t('shell.common.save')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                className="min-h-11 flex-1 justify-center"
                onPress={() => bridgeStore.followUpReorder(sessionId, index, 0)}
                onLongPress={() => {
                  setEditText(item.text);
                  setEditingId(item.id);
                }}
              >
                <Text numberOfLines={1} className="text-[15px] text-overlay-foreground">
                  {index + 1}. {item.text}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setEditText(item.text);
                  setEditingId(item.id);
                }}
                className="min-h-11 justify-center px-2 active:opacity-60"
              >
                <Text className="text-[13px] text-muted">{t('mobile.chat.edit')}</Text>
              </Pressable>
              <Pressable
                onPress={() => bridgeStore.followUpRemove(sessionId, item.id)}
                accessibilityLabel={t('shell.common.delete')}
                className="min-h-11 justify-center px-2 active:opacity-60"
              >
                <Glyph name="cross" size={14} color={vars['--muted']} />
              </Pressable>
            </>
          )}
        </View>
      ))}
    </View>
  );
}
