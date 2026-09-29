import { CameraView } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/shell/sheet';
import type { FingerPrompt } from './use-servers';

/** Full-screen camera; the camera frame is always dark, so its chrome uses fixed light-on-dark text. */
export function Scanner({
  visible,
  onClose,
  onScanned
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (result: { data: string }) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <View className="flex-row items-center justify-between pl-4 pr-1" style={{ paddingTop: insets.top + 8 }}>
          <Text className="text-[17px] font-semibold text-white">{t('mobile.settings.scanTitle')}</Text>
          <Pressable onPress={onClose} className="min-h-11 justify-center px-3 active:opacity-60">
            <Text className="text-[15px] font-semibold text-white">{t('shell.common.cancel')}</Text>
          </Pressable>
        </View>
        <View className="mt-3 flex-1 overflow-hidden">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
        </View>
        <View className="items-center p-6" style={{ paddingBottom: Math.max(24, insets.bottom) }}>
          <Text className="text-center text-[13px] text-white/70">{t('mobile.settings.scanHint')}</Text>
        </View>
      </View>
    </Modal>
  );
}

export function FingerprintSheet({ prompt, onAnswer }: { prompt: FingerPrompt | null; onAnswer: (save: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={prompt !== null} onClose={() => onAnswer(false)} title={t('mobile.settings.fingerprintTitle')}>
      <Text className="font-mono text-[13px] leading-5 text-overlay-foreground" selectable>
        {prompt?.fingerprint}
      </Text>
      <View className="mt-5 flex-row gap-2.5">
        <Pressable
          onPress={() => onAnswer(false)}
          className="min-h-11 flex-1 items-center justify-center rounded-xl bg-surface-secondary active:opacity-70"
        >
          <Text className="text-[15px] font-semibold text-surface-secondary-foreground">
            {t('mobile.settings.rejectFingerprint')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onAnswer(true)}
          className="min-h-11 flex-1 items-center justify-center rounded-xl bg-default active:opacity-80"
        >
          <Text className="text-[15px] font-semibold text-default-foreground">{t('mobile.settings.saveFingerprint')}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
