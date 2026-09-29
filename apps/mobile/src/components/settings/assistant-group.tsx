import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { savePersona, usePersona } from '@/bridge/use-persona';
import { Avatar } from '@/components/shell/avatar';
import { FieldRow, Group } from './group';

export function AssistantGroup() {
  const { t } = useTranslation();
  const persona = usePersona();
  const [name, setName] = useState(persona.name);
  const [mark, setMark] = useState(persona.mark);

  useEffect(() => {
    setName(persona.name);
    setMark(persona.mark);
  }, [persona]);

  const save = () => savePersona({ name, mark });

  return (
    <>
      <View className="items-center pb-5">
        <Avatar size={64} />
      </View>
      <Group title={t('mobile.settings.assistant')} footer={t('mobile.settings.assistantHint')}>
        <FieldRow
          label={t('mobile.settings.assistantName')}
          value={name}
          onChangeText={setName}
          onEndEditing={save}
          placeholder="Fast"
          maxLength={24}
          autoCapitalize="words"
        />
        <FieldRow
          label={t('mobile.settings.assistantMark')}
          value={mark}
          onChangeText={(next) => setMark(Array.from(next).slice(0, 2).join(''))}
          onEndEditing={save}
          placeholder={t('mobile.settings.assistantMarkPlaceholder')}
        />
      </Group>
    </>
  );
}
