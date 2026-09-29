import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Hairline, SectionLabel, Sheet } from '@/components/shell/sheet';
import { ComposerPill } from './ComposerPill';
import { sessionComposerGate, StopControl } from './gate';
import { FollowUpsBar } from './Questions';
import { getToolCategory } from './ToolPipeline';

const DANGER_ACTION = 'min-h-11 justify-center pl-3 active:opacity-60';
const DANGER_TEXT = 'text-[15px] font-semibold text-danger';

export function RunSheet({
  sessionId,
  visible,
  onClose
}: {
  sessionId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record, snapshot.connection === 'open');
  const liveProcs = record?.transcript.liveProcs ?? [];
  const [interrupt, setInterrupt] = useState('');

  const state =
    gate?.runState === 'running'
      ? t('mobile.chat.runRunning')
      : gate?.runState === 'stopping'
        ? t('mobile.chat.runStopping')
        : t('mobile.chat.runIdle');
  const step = record?.transcript.entries
    .at(-1)
    ?.tools?.findLast((tool) => tool.status === 'running');
  const doing = step ? t(`mobile.brief.verb.${getToolCategory(step.tool).cat}`) : '';

  const sendInterrupt = () => {
    const text = interrupt.trim();
    if (!text) return;
    bridgeStore.interruptAndSay(sessionId, text);
    setInterrupt('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('mobile.chat.consoleTitle')}>
      <SectionLabel>{t('mobile.chat.runStatus')}</SectionLabel>
      <View className="min-h-11 flex-row items-center">
        <Text numberOfLines={1} className="flex-1 text-[15px] text-overlay-foreground">
          {doing ? `${state} · ${doing}` : state}
        </Text>
        {record ? (
          <StopControl
            sessionId={sessionId}
            record={record}
            gate={gate}
            label={t('shell.common.stop')}
            className={DANGER_ACTION}
            textClassName={DANGER_TEXT}
          />
        ) : null}
      </View>

      {liveProcs.length > 0 ? (
        <>
          <SectionLabel>{t('mobile.chat.liveProcs', { count: liveProcs.length })}</SectionLabel>
          {liveProcs.map((proc, i) => (
            <View key={proc.procId}>
              {i > 0 ? <Hairline /> : null}
              <View className="min-h-11 flex-row items-center">
                <Text numberOfLines={1} className="flex-1 font-mono text-[13px] text-overlay-foreground">
                  {proc.command}
                </Text>
                <Pressable onPress={() => bridgeStore.killProc(sessionId, proc.procId)} className={DANGER_ACTION}>
                  <Text className={DANGER_TEXT}>{t('mobile.chat.kill')}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}

      <SectionLabel>{t('mobile.chat.interruptTitle')}</SectionLabel>
      <ComposerPill
        value={interrupt}
        onChange={setInterrupt}
        onSend={sendInterrupt}
        placeholder={t('mobile.chat.interruptPlaceholder')}
        inSheet
      />

      <FollowUpsBar sessionId={sessionId} />
    </Sheet>
  );
}
