import { router } from 'expo-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { Attention, SessionFacts } from '@/bridge/attention';
import { Hairline, SectionLabel, Sheet } from './sheet';

export function StatusSheet({
  visible,
  onClose,
  attention,
  homeId
}: {
  visible: boolean;
  onClose: () => void;
  attention: Attention;
  homeId: string | null;
}) {
  const { t } = useTranslation();
  const open = (sessionId: string) => {
    onClose();
    if (sessionId !== homeId) router.push(`/session/${sessionId}`);
  };
  const empty = attention.needs.length === 0 && attention.working.length === 0;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('mobile.status.title')}>
      {empty ? <Text className="py-6 text-[15px] text-muted">{t('mobile.status.empty')}</Text> : null}
      {attention.needs.length > 0 ? (
        <>
          <SectionLabel>{t('mobile.status.needs')}</SectionLabel>
          <Rows facts={attention.needs} onOpen={open} detail={(f) => f.pending?.text ?? ''} />
        </>
      ) : null}
      {attention.working.length > 0 ? (
        <>
          <SectionLabel>{t('mobile.status.working')}</SectionLabel>
          <Rows facts={attention.working} onOpen={open} detail={() => t('mobile.status.running')} />
        </>
      ) : null}
      <Text className="pt-6 text-[11px] leading-4 text-muted">{t('mobile.status.scope')}</Text>
    </Sheet>
  );
}

function Rows({
  facts,
  onOpen,
  detail
}: {
  facts: SessionFacts[];
  onOpen: (sessionId: string) => void;
  detail: (f: SessionFacts) => string;
}) {
  return (
    <View>
      {facts.map((f, i) => (
        <Fragment key={f.sessionId}>
          {i > 0 ? <Hairline /> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(f.sessionId)}
            className="min-h-11 justify-center py-2.5 active:opacity-60"
          >
            <Text numberOfLines={1} className="text-[15px] text-overlay-foreground">
              {f.title}
            </Text>
            {detail(f) ? (
              <Text numberOfLines={2} className="mt-0.5 text-[13px] text-muted">
                {detail(f)}
              </Text>
            ) : null}
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}
