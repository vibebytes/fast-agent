import { countDiffStats, parseDiffWithLineNumbers } from '@fast-ide/session-view';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from '@/components/glyphs';
import { Hairline, Sheet } from '@/components/shell/sheet';
import { lightImpact } from '@/lib/haptics';
import { useThemeVars } from '@/theme/theme-context';
import {
  diffTextOf,
  DiffLineRow,
  getToolCategory,
  toolHint,
  ToolDetailSheet,
  ToolPipelineSheet,
  type ToolLike
} from './ToolPipeline';

/** One quiet line for a turn's tools; tap to unfold the full pipeline in a bottom sheet. */
export function BriefTools({ tools }: { tools: ToolLike[] }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState<ToolLike | null>(null);
  if (tools.length === 0) return null;

  const running = [...tools].reverse().find((x) => x.status === 'running');
  const failed = tools.filter((x) => x.status === 'error' || x.status === 'cancelled').length;
  const label = running
    ? t('mobile.brief.running', { what: t(`mobile.brief.verb.${getToolCategory(running.tool).cat}`) })
    : failed > 0
      ? t('mobile.brief.doneFailed', { count: tools.length })
      : t('mobile.brief.done', { count: tools.length });

  return (
    <View className="mt-1.5">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          lightImpact();
          setSheetOpen(true);
        }}
        className="min-h-11 flex-row items-center gap-1.5 self-start pr-2 active:opacity-60"
      >
        <Glyph
          name={running ? 'sparkles' : failed > 0 ? 'alert' : 'check'}
          size={14}
          color={failed > 0 && !running ? vars['--danger'] : vars['--muted']}
        />
        <Text className="text-[13px] text-muted">{label}</Text>
        {failed > 0 && !running ? (
          <Text className="text-[13px] text-danger">{t('mobile.brief.failed', { count: failed })}</Text>
        ) : null}
        <Glyph name="chevron-right" size={13} color={vars['--muted']} />
      </Pressable>
      <ToolPipelineSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        tools={tools}
        onSelectTool={(tool) => setDetail(tool)}
      />
      <ToolDetailSheet tool={detail} onClose={() => setDetail(null)} />
      <BriefChanges tools={tools} />
    </View>
  );
}

/** "Changed N files +a −d"; tap for the diffs in a sheet. */
function BriefChanges({ tools }: { tools: ToolLike[] }) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const [open, setOpen] = useState(false);
  const diffs = useMemo(
    () =>
      tools.flatMap((tool) => {
        const text = diffTextOf(tool);
        return text ? [{ id: tool.id, title: toolHint(tool) || tool.tool, text, stats: countDiffStats(text) }] : [];
      }),
    [tools]
  );
  if (diffs.length === 0) return null;
  const add = diffs.reduce((n, d) => n + d.stats.add, 0);
  const del = diffs.reduce((n, d) => n + d.stats.del, 0);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="min-h-11 flex-row items-center gap-1.5 self-start pr-2 active:opacity-60"
      >
        <Glyph name="full" size={14} color={vars['--muted']} />
        <Text className="text-[13px] text-muted">{t('mobile.brief.changed', { count: diffs.length })}</Text>
        <Text className="font-mono text-[13px] text-success">+{add}</Text>
        <Text className="font-mono text-[13px] text-danger">−{del}</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('mobile.chat.diffTitle')}>
        {diffs.map((d, i) => (
          <View key={d.id || i}>
            {i > 0 ? <Hairline /> : null}
            <View className="flex-row items-center justify-between py-2.5">
              <Text numberOfLines={1} className="flex-1 pr-2 font-mono text-[13px] text-overlay-foreground">
                {d.title}
              </Text>
              <Text className="font-mono text-[11px] text-success">+{d.stats.add} </Text>
              <Text className="font-mono text-[11px] text-danger">−{d.stats.del}</Text>
            </View>
            <DiffLines text={d.text} />
          </View>
        ))}
      </Sheet>
    </>
  );
}

function DiffLines({ text }: { text: string }) {
  const lines = useMemo(() => parseDiffWithLineNumbers(text), [text]);
  return (
    <View className="mb-3 overflow-hidden rounded-xl bg-surface-secondary py-1">
      {lines.map((line, i) => (
        <DiffLineRow key={i} line={line} />
      ))}
    </View>
  );
}
