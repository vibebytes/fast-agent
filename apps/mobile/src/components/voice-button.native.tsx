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
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';

import { Glyph } from '@/components/glyphs';
import { ensureVoiceEngine, transcribeFile } from '@/lib/voice-engine';
import { FastThemeScope, useThemeVars } from '@/theme/theme-context';

interface VoiceInputProps {
  onResult: (text: string) => void;
  onSend?: (text: string) => void;
  disabled?: boolean;
  /** Sits inside the composer pill: no own background, round hit area. */
  inline?: boolean;
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
  const expandAnim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: active ? 1 : 0,
      duration: 220,
      useNativeDriver: false
    }).start();
  }, [active, expandAnim]);

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
    <Animated.View
      style={{
        height: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 38] }),
        opacity: expandAnim,
        overflow: 'hidden'
      }}
      className="w-full flex-row items-center justify-center gap-[3px]"
    >
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3.5,
            height: 26,
            borderRadius: 2,
            backgroundColor: color,
            opacity: bar.interpolate({
              inputRange: [0.1, 0.4, 1],
              outputRange: [0.4, 0.8, 1],
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
    </Animated.View>
  );
}

export function VoiceButton({ onResult, onSend, disabled, inline = false }: VoiceInputProps) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const insets = useSafeAreaInsets();
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
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const setPhaseSafe = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const recorder = useAudioRecorder(RECORD_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (phase === 'listening') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 1100, useNativeDriver: true })
        ])
      );
      loop.start();
    } else {
      pulseAnim.setValue(0);
    }
    return () => loop?.stop();
  }, [phase, pulseAnim]);

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 5,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 45 || gesture.vy > 0.5) {
          hapticImpact(Haptics.ImpactFeedbackStyle.Light);
          closePanel();
        }
      }
    })
  ).current;

  const handlePressOut = () => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    if (phaseRef.current === 'listening') {
      void stopAndTranscribe();
    }
  };

  const handleTap = () => {
    if (disabled) return;
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    pressingRef.current = false;
    setActive(true);
    transcriptRef.current = '';
    setTranscript('');
    setError(null);
    errorRef.current = null;
    void startListening();
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

  const handleSendOrFinish = async () => {
    if (phaseRef.current === 'listening') {
      setPhaseSafe('transcribing');
      waveAnim.setValue(0);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) {
          setError({ code: 'emptyRecording' });
          setPhaseSafe('idle');
          return;
        }
        const text = await transcribeFile(uri);
        const fullText = (transcriptRef.current ? transcriptRef.current + (text ?? '') : (text ?? '')).trim();
        if (fullText) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          if (onSend) {
            onSend(fullText);
          } else {
            onResult(fullText);
          }
          closePanel();
          return;
        }
      } catch (e) {
        errorRef.current = 'transcribe';
        setError({ code: 'transcribe', message: String((e as Error)?.message ?? e) });
      } finally {
        setPhaseSafe('idle');
      }
      return;
    }

    const text = transcript.trim();
    if (!text) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (onSend) {
      onSend(text);
    } else {
      onResult(text);
    }
    closePanel();
  };

  const handleInsert = () => {
    const text = transcript.trim();
    if (!text) return;
    hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    onResult(text);
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
            className={`h-[44px] w-[44px] border-2 border-focus ${inline ? 'rounded-full' : 'rounded-2xl'}`}
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
          className={
            inline
              ? 'h-[44px] w-[44px] items-center justify-center rounded-full active:opacity-60 disabled:opacity-40'
              : 'h-[44px] w-[44px] items-center justify-center rounded-2xl bg-surface-secondary active:opacity-75 disabled:opacity-40'
          }
        >
          <Glyph name="mic" color={inline ? vars['--muted'] : vars['--foreground']} size={20} />
        </Pressable>

        {hint ? (
          <View pointerEvents="none" className="absolute bottom-full left-0 mb-2">
            <View className="rounded-xl bg-foreground px-3 py-1.5">
              <Text numberOfLines={1} className="text-[13px] font-medium text-background">
                {t('mobile.voice.holdHint')}
              </Text>
            </View>
          </View>
        ) : null}
      </Animated.View>

      <Modal
        visible={active}
        transparent
        animationType="slide"
        onRequestClose={closePanel}
        statusBarTranslucent
      >
        <FastThemeScope>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 justify-end"
          >
            {/* Dimmed backdrop */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closePanel}
              className="bg-black/55"
              accessibilityRole="button"
              accessibilityLabel={t('mobile.voice.closeInputA11y')}
            />

            {/* Solid elevated sheet surface */}
            <View
              style={{
                backgroundColor: vars['--overlay'] || vars['--surface'],
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderColor: vars['--border'],
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.12,
                shadowRadius: 16,
                elevation: 24,
                paddingBottom: Math.max(28, insets.bottom + 8)
              }}
              className="px-5 pt-2"
            >
              {/* Grab handle with PanResponder (Swipe down to dismiss) */}
              <View {...panResponder.panHandlers} className="items-center pb-2 pt-1">
                <View className="h-1.5 w-10 rounded-full bg-foreground/20" />
              </View>

              {/* Status Header */}
              <View className="mb-2 flex-row items-center justify-between px-1">
                <View className="flex-row items-center gap-2.5">
                  <View className="relative h-3 w-3 items-center justify-center">
                    {phase === 'listening' ? (
                      <Animated.View
                        style={{
                          position: 'absolute',
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: '#ef4444',
                          opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.65, 0] }),
                          transform: [
                            {
                              scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] })
                            }
                          ]
                        }}
                      />
                    ) : null}
                    <View
                      className={`h-2.5 w-2.5 rounded-full ${
                        phase === 'listening'
                          ? 'bg-danger'
                          : phase === 'transcribing' || phase === 'loading'
                            ? 'bg-focus'
                            : transcript.trim()
                              ? 'bg-emerald-500'
                              : 'bg-muted'
                      }`}
                    />
                  </View>
                  <Text className="text-[13px] font-semibold text-muted">{statusText}</Text>
                </View>

                <Pressable
                  onPress={closePanel}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('shell.common.close')}
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface-secondary active:opacity-60"
                >
                  <Glyph name="cross" size={13} color={vars['--muted']} />
                </Pressable>
              </View>

              {/* Dynamic waveform visualizer */}
              <WaveformVisualizer
                metering={recorderState.metering ?? -160}
                active={phase === 'listening'}
                color={vars['--focus']}
              />

              {/* Error banner if any */}
              {error ? (
                <View className="my-2 flex-row items-center justify-between gap-1.5 rounded-xl bg-danger/10 px-3 py-2">
                  <Text numberOfLines={2} className="flex-1 text-[13px] leading-5 text-danger">
                    {voiceErrorCopy(t, error)}
                  </Text>
                  {error.code === 'not-allowed' ? (
                    <Pressable
                      onPress={() => void Linking.openSettings()}
                      className="min-h-8 justify-center px-2 active:opacity-60"
                    >
                      <Text className="text-[13px] font-semibold text-link">{t('mobile.voice.goSettings')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => void startListening()}
                      className="min-h-8 justify-center px-2 active:opacity-60"
                    >
                      <Text className="text-[13px] font-semibold text-link">{t('shell.common.retry')}</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}

              {/* Elastic transcript card with inline clear button */}
              <View className="relative mt-1 overflow-hidden rounded-2xl border border-border/70 bg-surface-secondary/70">
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
                  underlineColorAndroid="transparent"
                  style={{
                    minHeight: 76,
                    maxHeight: 180,
                    paddingTop: 12,
                    paddingBottom: 12,
                    paddingLeft: 14,
                    paddingRight: transcript.trim() ? 40 : 14
                  }}
                  className="text-[15px] leading-6 text-surface-secondary-foreground"
                />
                {transcript.trim() ? (
                  <Pressable
                    onPress={handleClear}
                    accessibilityRole="button"
                    accessibilityLabel={t('mobile.voice.clearA11y')}
                    hitSlop={8}
                    className="absolute right-2.5 top-2.5 h-7 w-7 items-center justify-center rounded-full bg-border/60 active:opacity-60"
                  >
                    <Glyph name="cross" size={11} color={vars['--muted']} />
                  </Pressable>
                ) : null}
              </View>

              {/* Bottom Action Bar */}
              <View className="mt-3.5 flex-row items-center justify-between">
                {/* Left: Recording state control */}
                <View className="flex-row items-center gap-2">
                  {phase === 'listening' ? (
                    <Pressable
                      onPress={toggleListening}
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.voice.stopRecordA11y')}
                      className="h-11 flex-row items-center gap-2 rounded-2xl bg-danger/10 px-4 active:opacity-75"
                    >
                      <View className="h-2.5 w-2.5 rounded-[2px] bg-danger" />
                      <Text className="text-[14px] font-semibold text-danger">{t('shell.common.stop')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={toggleListening}
                      accessibilityRole="button"
                      accessibilityLabel={transcript.trim() ? t('mobile.voice.continueA11y') : t('mobile.voice.startA11y')}
                      disabled={phase === 'loading' || phase === 'transcribing'}
                      className="h-11 flex-row items-center gap-2 rounded-2xl border border-border/70 bg-surface-secondary px-4 active:opacity-75 disabled:opacity-40"
                    >
                      <Glyph name="mic" size={15} color={vars['--foreground']} />
                      <Text className="text-[14px] font-semibold text-foreground">
                        {transcript.trim() ? t('mobile.voice.continueSpeak') : t('mobile.voice.speak')}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {/* Right: Actions */}
                <View className="flex-row items-center gap-2">
                  {transcript.trim() && phase !== 'listening' ? (
                    <Pressable
                      onPress={handleInsert}
                      disabled={phase === 'loading' || phase === 'transcribing'}
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.voice.insertA11y')}
                      className="h-11 items-center justify-center rounded-2xl border border-border/70 bg-surface-secondary px-4 active:opacity-70 disabled:opacity-30"
                    >
                      <Text className="text-[14px] font-semibold text-foreground">{t('mobile.voice.insert')}</Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={handleSendOrFinish}
                    disabled={
                      phase === 'loading' ||
                      phase === 'transcribing' ||
                      (phase !== 'listening' && !transcript.trim())
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t('shell.common.send')}
                    className="h-11 min-w-[96px] flex-row items-center justify-center gap-1.5 rounded-2xl bg-default px-5 shadow-sm active:scale-95 active:opacity-85 disabled:opacity-30"
                  >
                    <Glyph name="arrow-up" size={15} color={vars['--default-foreground']} />
                    <Text className="text-[15px] font-bold text-default-foreground">{t('shell.common.send')}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </FastThemeScope>
      </Modal>
    </>
  );
}
