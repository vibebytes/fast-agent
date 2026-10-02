import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

interface VoiceInputProps {
  onResult: (text: string) => void;
  onSend?: (text: string) => void;
  disabled?: boolean;
  inline?: boolean;
}

export function VoiceButton({ onResult, onSend, disabled, inline = false }: VoiceInputProps) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    if (disabled || typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(t('mobile.voice.webUnsupported'));
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.onstart = () => {
        setListening(true);
      };

      recognition.onresult = (event: any) => {
        const text = event.results?.[0]?.[0]?.transcript;
        if (text?.trim()) {
          onResult(text.trim());
        }
      };

      recognition.onerror = () => {
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setListening(false);
    }
  }, [disabled, onResult, t]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignored
      }
    }
    setListening(false);
  }, []);

  return (
    <Pressable
      onPress={listening ? stopListening : startListening}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('mobile.voice.a11y')}
      className={`h-[44px] w-[44px] items-center justify-center ${inline ? 'rounded-full' : 'rounded-2xl'} ${
        listening ? 'bg-default' : inline ? '' : 'bg-surface-secondary'
      } active:opacity-60 disabled:opacity-40`}
    >
      <Glyph
        name="mic"
        color={listening ? vars['--default-foreground'] : inline ? vars['--muted'] : vars['--foreground']}
        size={20}
        filled={listening}
      />
    </Pressable>
  );
}
