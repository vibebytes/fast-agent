import { LOCALE_NATIVE_NAME, SUPPORTED, type LocalePref } from '@fast-ide/i18n/browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Sheet } from '@/components/shell/sheet';
import { useLocalePrefs } from '@/i18n/locale-context';
import { lightImpact } from '@/lib/haptics';
import { Group, Row } from './group';

const OPTIONS: LocalePref[] = ['system', ...SUPPORTED];

export function LanguageGroup() {
  const { t } = useTranslation();
  const { localePref, setLocalePref } = useLocalePrefs();
  const [open, setOpen] = useState(false);
  const nameOf = (code: LocalePref) => (code === 'system' ? t('settings.languageSystem') : LOCALE_NATIVE_NAME[code]);
  return (
    <>
      <Group title={t('settings.general.language')} footer={t('settings.general.languageDescription')}>
        <Row
          label={t('settings.general.language')}
          icon="globe"
          badge="teal"
          value={nameOf(localePref)}
          chevron
          onPress={() => setOpen(true)}
        />
      </Group>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('settings.general.language')}>
        <Group>
          {OPTIONS.map((code) => (
            <Row
              key={code}
              label={nameOf(code)}
              checked={localePref === code}
              onPress={() => {
                lightImpact();
                setLocalePref(code);
                setOpen(false);
              }}
            />
          ))}
        </Group>
      </Sheet>
    </>
  );
}
