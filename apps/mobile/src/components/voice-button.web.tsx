import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

interface VoiceInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function VoiceButton({ onSend, disabled }: VoiceInputProps) {
  const vars = useThemeVars();
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    if (disabled || typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音识别功能，请在支持的浏览器（如 Chrome）中重试。');
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
          onSend(text.trim());
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
  }, [disabled, onSend]);

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
      accessibilityLabel="语音输入"
      className={`h-[44px] w-[44px] items-center justify-center rounded-2xl ${
        listening ? 'bg-primary' : 'bg-surface-secondary'
      } active:scale-95 active:opacity-75 disabled:opacity-40`}
    >
      <Glyph
        name="mic"
        color={listening ? vars['--primary-foreground'] || '#ffffff' : vars['--foreground']}
        size={20}
        filled={listening}
      />
    </Pressable>
  );
}
