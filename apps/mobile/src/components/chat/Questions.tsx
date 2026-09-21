import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PendingQuestion, PendingQuestionBatch } from '@fast-ide/session-view';
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
import { useThemeVars } from '@/theme/theme-context';

export function ApprovalSlot({ sessionId }: { sessionId: string }) {
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

export function QuestionBatchSlot({ sessionId }: { sessionId: string }) {
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

export function QuestionBatchPane({
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

export function QuestionSlot({ sessionId }: { sessionId: string }) {
  const snapshot = useBridgeSnapshot();
  const questions = snapshot.records[sessionId]?.transcript.questions ?? [];
  if (questions.length === 0) return null;
  return (
    <View className="gap-2.5 px-3.5 pb-2">
      {questions.map((question) => (
        <QuestionCard key={question.id} sessionId={sessionId} question={question} />
      ))}
    </View>
  );
}

export function QuestionCard({ sessionId, question }: { sessionId: string; question: PendingQuestion }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [custom, setCustom] = useState('');
  return (
    <View
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
  );
}

export function FollowUpsBar({ sessionId }: { sessionId: string }) {
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

