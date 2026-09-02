import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import {
  AudioQuality,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native';

import { useTranslation } from 'react-i18next';

import { Glyph } from '@/components/glyphs';
import { ensureVoiceEngine, transcribeFile } from '@/lib/voice-engine';
import { FastThemeScope, useThemeMode, useThemeVars } from '@/theme/theme-context';

interface VoiceInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

interface VoiceError {
  code: string;
  message?: string;
}

function voiceErrorCopy(t: (key: string) => string, error: VoiceError): string {
  if (error.code === 'not-allowed') return t('mobile.voice.micDenied');
  if (error.code === 'emptyRecording') return t('mobile.voice.emptyRecording');
  return error.message?.trim() || t('mobile.voice.problem');
}

type Phase = 'idle' | 'loading' | 'listening' | 'transcribing';

const RECORD_OPTIONS: RecordingOptions = {
  isMeteringEnabled: true,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { audioQuality: AudioQuality.HIGH },
  web: {}
};

const hapticImpact = (style: Haptics.ImpactFeedbackStyle) => {
  Haptics.impactAsync(style).catch(() => {});
};

const NUM_BARS = 21;
const BAR_FACTORS = [
  0.22, 0.35, 0.52, 0.7, 0.88, 1.0, 0.95, 0.82, 0.68, 0.55, 0.45, 0.58, 0.76, 0.92, 1.0, 0.85, 0.68, 0.5, 0.36, 0.24, 0.18
];

function WaveformVisualizer({ metering, active, color }: { metering: number; active: boolean; color: string }) {
  const bars = useRef(Array.from({ length: NUM_BARS }, () => new Animated.Value(0.15))).current;
  const idleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (active) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(idleAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(idleAnim, { toValue: 0, duration: 1200, useNativeDriver: true })
        ])
      );
      loop.start();
    } else {
      idleAnim.setValue(0);
    }
    return () => loop?.stop();
  }, [active, idleAnim]);

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => Animated.timing(b, { toValue: 0.12, duration: 180, useNativeDriver: true }).start());
      return;
    }

    const norm = Math.max(0, Math.min(1, (metering + 55) / 55));
    const power = Math.pow(norm, 1.25);

    const animations = bars.map((bar, i) => {
      const factor = BAR_FACTORS[i] ?? 0.5;
      const jitter = ((i * 7) % 5) * 0.04;
      const target = Math.max(0.12, Math.min(1.0, power * factor + jitter * norm + 0.1));
      return Animated.spring(bar, {
        toValue: target,
        tension: 160 + (i % 4) * 20,
        friction: 8 + (i % 3) * 2,
        useNativeDriver: true
      });
    });

    Animated.parallel(animations).start();
  }, [active, metering, bars]);

  return (
    <View className="h-9 w-full flex-row items-center justify-center gap-[3px] py-1">
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: 28,
            borderRadius: 1.5,
            backgroundColor: color,
            opacity: bar.interpolate({
              inputRange: [0.1, 0.4, 1],
              outputRange: [0.35, 0.75, 1],
              extrapolate: 'clamp'
            }),
            transform: [
              {
                scaleY: bar.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.12, 1],
                  extrapolate: 'clamp'
                })
              }
            ]
          }}
        />
      ))}
    </View>
  );
}

export function VoiceButton({ onSend, disabled }: VoiceInputProps) {
  const { t } = useTranslation();
  const { scheme } = useThemeMode();
  const vars = useThemeVars();
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<VoiceError | null>(null);
  const [hint, setHint] = useState(false);

  const transcriptRef = useRef('');
  const pressingRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const pressAnim = useRef(new Animated.Value(1)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  const setPhaseSafe = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const recorder = useAudioRecorder(RECORD_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);

  useEffect(() => {
    if (recorderState.metering == null) return;
    const v = Math.max(0, Math.min(1, (recorderState.metering + 60) / 60));
    Animated.timing(waveAnim, { toValue: v, duration: 90, useNativeDriver: true }).start();
  }, [recorderState.metering, waveAnim]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    []
  );

  const startListening = async () => {
    setError(null);
    errorRef.current = null;
    setPhaseSafe('loading');
    try {
      void ensureVoiceEngine().catch(() => {});
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        errorRef.current = 'not-allowed';
        setError({ code: 'not-allowed' });
        setPhaseSafe('idle');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhaseSafe('listening');
    } catch (e) {
      errorRef.current = 'engine';
      setPhaseSafe('idle');
      setError({ code: 'engine', message: String((e as Error)?.message ?? e) });
    }
  };

  const stopAndTranscribe = async () => {
    if (phaseRef.current !== 'listening') return;
    setPhaseSafe('transcribing');
    waveAnim.setValue(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError({ code: 'emptyRecording' });
        return;
      }
      const text = await transcribeFile(uri);
      if (text) {
        const next = transcriptRef.current ? transcriptRef.current + text : text;
        transcriptRef.current = next;
        setTranscript(next);
      }
    } catch (e) {
      errorRef.current = 'transcribe';
      setError({ code: 'transcribe', message: String((e as Error)?.message ?? e) });
    } finally {
      setPhaseSafe('idle');
    }
  };

  const beginSession = () => {
    if (disabled) return;
    pressingRef.current = true;
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
    setActive(true);
    transcriptRef.current = '';
    setTranscript('');
    setError(null);
    errorRef.current = null;
    void startListening();
  };

  const closePanel = useCallback(() => {
    pressingRef.current = false;
    if (phaseRef.current === 'listening') {
      recorder.stop().catch(() => {});
    }
    setActive(false);
    setPhaseSafe('idle');
    waveAnim.setValue(0);
    setError(null);
    errorRef.current = null;
  }, [recorder]);

  const handlePressOut = () => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    if (phaseRef.current === 'listening') {
      void stopAndTranscribe();
    }
  };

  const handleTap = () => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 1500);
  };

  const animatePressIn = () => {
    Animated.parallel([
      Animated.spring(pressAnim, { toValue: 0.86, useNativeDriver: true, speed: 40, bounciness: 5 }),
      Animated.timing(ringAnim, { toValue: 1, duration: 160, useNativeDriver: true })
    ]).start();
  };

  const animatePressOut = () => {
    Animated.parallel([
      Animated.spring(pressAnim, { toValue: 1, useNativeDriver: true, speed: 26, bounciness: 9 }),
      Animated.timing(ringAnim, { toValue: 0, duration: 220, useNativeDriver: true })
    ]).start();
  };

  const handleSend = () => {
    const text = transcript.trim();
    if (!text) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSend(text);
    closePanel();
  };

  const toggleListening = () => {
    if (phaseRef.current === 'listening') {
      void stopAndTranscribe();
    } else {
      hapticImpact(Haptics.ImpactFeedbackStyle.Light);
      void startListening();
    }
  };

  const handleClear = () => {
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    transcriptRef.current = '';
    setTranscript('');
  };

  const statusText = error
    ? voiceErrorCopy(t, error)
    : phase === 'loading'
      ? t('mobile.voice.preparing')
      : phase === 'listening'
        ? t('mobile.voice.listening')
        : phase === 'transcribing'
          ? t('mobile.voice.recognizing')
          : transcript.trim()
            ? t('mobile.voice.editable')
            : t('mobile.voice.noSpeech');

  return (
    <>
      <Animated.View style={{ transform: [{ scale: pressAnim }] }} className="relative">
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <Animated.View
            style={{
              opacity: ringAnim,
              transform: [{ scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.4] }) }]
            }}
            className="h-[44px] w-[44px] rounded-2xl border-2 border-primary"
          />
        </View>
        <Pressable
          onPressIn={animatePressIn}
          onPressOut={() => {
            animatePressOut();
            handlePressOut();
          }}
          onPress={handleTap}
          onLongPress={beginSession}
          delayLongPress={350}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.voice.holdA11y')}
          className="h-[44px] w-[44px] items-center justify-center rounded-2xl bg-surface-secondary active:opacity-75 disabled:opacity-40"
        >
          <Glyph name="mic" color={vars['--foreground']} size={20} />
        </Pressable>

        {hint ? (
          <View pointerEvents="none" className="absolute bottom-full left-0 mb-2">
            <View className="rounded-xl bg-foreground px-3 py-1.5 shadow-lg">
              <Text numberOfLines={1} className="text-xs font-medium text-background">
                {t('mobile.voice.holdHint')}
              </Text>
            </View>
          </View>
        ) : null}
      </Animated.View>

      <Modal visible={active} transparent animationType="fade" onRequestClose={closePanel}>
        <FastThemeScope>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 justify-end bg-black/60"
          >
            <Pressable className="flex-1" onPress={closePanel} accessibilityLabel={t('mobile.voice.closeInputA11y')} />
            <BlurView
              intensity={Platform.OS === 'ios' ? 95 : 100}
              tint={scheme === 'dark' ? 'dark' : 'light'}
              className="overflow-hidden rounded-t-[32px] border-t border-border bg-surface px-5 pb-8 pt-3 shadow-2xl"
            >
              <View className="items-center pb-3">
                <View className="h-1 w-9 rounded-full bg-border" />
              </View>

              <View className="flex-row items-center justify-between px-1 pb-1">
                <View className="flex-row items-center gap-2">
                  <View
                    className={`h-2.5 w-2.5 rounded-full ${
                      phase === 'listening'
                        ? 'bg-primary animate-pulse'
                        : phase === 'transcribing' || phase === 'loading'
                          ? 'bg-focus'
                          : 'bg-muted'
                    }`}
                  />
                  <Text className="text-xs font-semibold text-muted">{statusText}</Text>
                </View>
                <Pressable
                  onPress={closePanel}
                  accessibilityLabel={t('shell.common.close')}
                  className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-secondary"
                >
                  <Glyph name="cross" size={13} color={vars['--muted']} />
                </Pressable>
              </View>

              <WaveformVisualizer
                metering={recorderState.metering ?? -160}
                active={phase === 'listening'}
                color={vars['--foreground']}
              />

              {error ? (
                <View className="mb-2.5 flex-row items-center justify-between rounded-2xl bg-destructive/10 px-3.5 py-2.5">
                  <Text numberOfLines={2} className="flex-1 text-xs leading-4 text-destructive">
                    {voiceErrorCopy(t, error)}
                  </Text>
                  {error.code === 'not-allowed' ? (
                    <Pressable
                      onPress={() => void Linking.openSettings()}
                      className="ml-2.5 rounded-full bg-destructive/15 px-3 py-1.5 active:opacity-70"
                    >
                      <Text className="text-xs font-semibold text-destructive">{t('mobile.voice.goSettings')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => void startListening()}
                      className="ml-2.5 rounded-full bg-destructive/15 px-3 py-1.5 active:opacity-70"
                    >
                      <Text className="text-xs font-semibold text-destructive">{t('shell.common.retry')}</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}

              <TextInput
                value={transcript}
                onChangeText={(t) => {
                  setTranscript(t);
                  transcriptRef.current = t;
                }}
                placeholder={t('mobile.voice.placeholder')}
                placeholderTextColor={vars['--muted']}
                multiline
                textAlignVertical="top"
                className="min-h-[132px] rounded-2xl border border-border/60 bg-surface-secondary px-4 py-3.5 text-base leading-6 text-foreground"
              />

              <View className="mt-3.5 flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  {phase === 'listening' ? (
                    <Pressable
                      onPress={toggleListening}
                      accessibilityLabel={t('mobile.voice.stopRecordA11y')}
                      className="h-9 flex-row items-center gap-2 rounded-full bg-default px-4 active:opacity-80"
                    >
                      <View className="h-2.5 w-2.5 rounded-[2px] bg-default-foreground" />
                      <Text className="text-xs font-semibold text-default-foreground">{t('shell.common.stop')}</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable
                        onPress={toggleListening}
                        accessibilityLabel={transcript.trim() ? t('mobile.voice.continueA11y') : t('mobile.voice.startA11y')}
                        disabled={phase === 'loading' || phase === 'transcribing'}
                        className="h-9 flex-row items-center gap-1.5 rounded-full bg-surface-secondary px-4 active:opacity-70 disabled:opacity-40"
                      >
                        <Glyph name="mic" size={13} color={vars['--foreground']} />
                        <Text className="text-xs font-semibold text-foreground">
                          {transcript.trim() ? t('mobile.voice.continueSpeak') : t('mobile.voice.speak')}
                        </Text>
                      </Pressable>
                      {transcript.trim() ? (
                        <Pressable
                          onPress={handleClear}
                          accessibilityLabel={t('mobile.voice.clearA11y')}
                          className="h-9 items-center justify-center rounded-full px-3 active:opacity-60"
                        >
                          <Text className="text-xs font-medium text-muted">{t('mobile.voice.clear')}</Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
                <Pressable
                  onPress={handleSend}
                  disabled={!transcript.trim() || phase === 'listening' || phase === 'transcribing'}
                  className="h-11 min-w-[96px] items-center justify-center rounded-2xl bg-default px-5 shadow-sm active:scale-95 active:opacity-80 disabled:opacity-30"
                >
                  <Text className="text-sm font-semibold text-default-foreground">{t('shell.common.send')}</Text>
                </Pressable>
              </View>
            </BlurView>
          </KeyboardAvoidingView>
        </FastThemeScope>
      </Modal>
    </>
  );
}
