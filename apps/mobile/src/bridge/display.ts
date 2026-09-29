/** How much of the agent's process a conversation shows: `brief` hides reasoning and folds tools into one line. */
export type Display = 'brief' | 'full';

/** Per-session choices the user made explicitly; sessions without one use the default. */
export type Displays = Record<string, Display>;

export function displayOf(displays: Displays, sessionId: string, isHome: boolean): Display {
  return displays[sessionId] ?? (isHome ? 'brief' : 'full');
}

export function toggled(display: Display): Display {
  return display === 'brief' ? 'full' : 'brief';
}

export function withDisplay(displays: Displays, sessionId: string, display: Display): Displays {
  return {...displays, [sessionId]: display};
}

export function parseDisplays(raw: string | null): Displays {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, Display] => entry[1] === 'brief' || entry[1] === 'full'
      )
    );
  } catch (error) {
    console.warn('[display] dropping unreadable display prefs', error);
    return {};
  }
}
