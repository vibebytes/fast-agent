import { LOCALE_NATIVE_NAME, SUPPORTED, type LocalePref } from '@fast-ide/i18n/browser';
import { useTranslation } from 'react-i18next';

import { useLocalePrefs } from '@/i18n/locale-context';
import { Group, Row } from './group';

const OPTIONS: LocalePref[] = ['system', ...SUPPORTED];

export function LanguageGroup() {
  const { t } = useTranslation();
  const { localePref, setLocalePref } = useLocalePrefs();
  return (
    <Group title={t('settings.general.language')} footer={t('settings.general.languageDescription')}>
      {OPTIONS.map((code) => (
        <Row
          key={code}
          label={code === 'system' ? t('settings.languageSystem') : LOCALE_NATIVE_NAME[code]}
          checked={localePref === code}
          onPress={() => setLocalePref(code)}
        />
      ))}
    </Group>
  );
}
