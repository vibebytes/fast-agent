import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { savePersona, usePersona } from '@/bridge/use-persona';
import { AmbientGlow, Avatar } from '@/components/shell/avatar';
import { useThemeMode } from '@/theme/theme-context';
import { FieldRow, Group } from './group';

export function AssistantGroup() {
  const { t } = useTranslation();
  const persona = usePersona();
  const { scheme } = useThemeMode();
  const isDark = scheme === 'dark';
  const [name, setName] = useState(persona.name);
  const [mark, setMark] = useState(persona.mark);

  useEffect(() => {
    setName(persona.name);
    setMark(persona.mark);
  }, [persona]);

  const save = () => savePersona({ name, mark });

  return (
    <>
      <View className="items-center pb-5 pt-1">
        <View className="items-center justify-center">
          {isDark ? <AmbientGlow size={140} opacity={0.28} /> : null}
          <Avatar size={68} />
        </View>
        <Text className="mt-3 text-[19px] font-bold tracking-tight text-foreground">
          {name.trim() || 'Fast'}
        </Text>
        <Text className="mt-0.5 text-[12px] font-medium text-muted">
          {mark.trim() ? `${t('mobile.settings.assistantMark')}: ${mark}` : t('mobile.settings.assistantHint')}
        </Text>
      </View>

      <Group title={t('mobile.settings.assistant')}>
        <FieldRow
          label={t('mobile.settings.assistantName')}
          icon="user"
          badge="blue"
          value={name}
          onChangeText={setName}
          onEndEditing={save}
          placeholder="Fast"
          maxLength={24}
          autoCapitalize="words"
        />
        <FieldRow
          label={t('mobile.settings.assistantMark')}
          icon="bolt"
          badge="purple"
          value={mark}
          onChangeText={(next) => setMark(Array.from(next).slice(0, 2).join(''))}
          onEndEditing={save}
          placeholder={t('mobile.settings.assistantMarkPlaceholder')}
        />
      </Group>
    </>
  );
}
