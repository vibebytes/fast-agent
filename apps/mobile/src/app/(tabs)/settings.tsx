import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';
import { AppearanceGroup } from '@/components/settings/appearance-group';
import { AssistantGroup } from '@/components/settings/assistant-group';
import { Group, Row } from '@/components/settings/group';
import { LanguageGroup } from '@/components/settings/language-group';
import { ServerGroup } from '@/components/settings/server-group';
import { useTabBarSpace } from '@/components/shell/tab-bar';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const bottomSpace = useTabBarSpace();
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader className="min-h-11 justify-center px-4">
        <Text className="text-[17px] font-semibold text-foreground">{t('mobile.tabs.settings')}</Text>
      </ScreenHeader>
      <View style={{ height: StyleSheet.hairlineWidth }} className="bg-separator" />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomSpace + 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <AssistantGroup />
        <ServerGroup />
        <AppearanceGroup />
        <LanguageGroup />
        <Group title={t('mobile.settings.about')}>
          <Row
            label={t('mobile.settings.version')}
            icon="info"
            badge="gray"
            value={Constants.expoConfig?.version ?? '—'}
          />
        </Group>
      </ScrollView>
    </View>
  );
}
