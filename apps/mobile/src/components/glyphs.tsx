import Svg, { Circle, Path } from 'react-native-svg';

export type GlyphName =
  | 'chat'
  | 'history'
  | 'settings'
  | 'plus'
  | 'mic'
  | 'cross'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'sparkles'
  | 'server'
  | 'palette';

export function Glyph({
  name,
  color,
  size,
  filled = false
}: {
  name: GlyphName;
  color: string;
  size: number;
  filled?: boolean;
}) {
  const stroke = filled ? 2.1 : 1.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'chat' ? (
        <Path
          d="M5.5 16.2 4 20l4.2-1.4A8.2 8.2 0 1 0 5.5 16.2Z"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
          fillOpacity={filled ? 0.16 : 0}
        />
      ) : null}
      {name === 'history' ? (
        <>
          <Circle cx="12" cy="12.5" r="7.2" stroke={color} strokeWidth={stroke} />
          <Path
            d="M12 9.4v3.3l2.3 1.5"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {name === 'settings' ? (
        <Path
          d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm7.2 3.1c0-.3-.2-.7-.4-1l1.3-1.5-1.6-2.8-2 .5c-.3-.2-.7-.4-1.1-.5l-.4-2H9l-.4 2c-.4.1-.8.3-1.1.5l-2-.5-1.6 2.8 1.3 1.5c-.2.3-.4.7-.4 1s.2.7.4 1L4 15.7l1.6 2.8 2-.5c.3.2.7.4 1.1.5l.4 2h4.2l.4-2c.4-.1.8-.3 1.1-.5l2 .5 1.6-2.8-1.3-1.5c.2-.3.4-.7.4-1Z"
          stroke={color}
          strokeWidth={stroke}
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
          fillOpacity={filled ? 0.16 : 0}
        />
      ) : null}
      {name === 'plus' ? (
        <Path
          d="M12 5.5v13M5.5 12h13"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      ) : null}
      {name === 'mic' ? (
        <>
          <Path
            d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={filled ? color : 'none'}
            fillOpacity={filled ? 0.16 : 0}
          />
          <Path
            d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {name === 'cross' ? (
        <Path
          d="M18 6 6 18M6 6l12 12"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'check' ? (
        <Path
          d="M20 6 9 17l-5-5"
          stroke={color}
          strokeWidth={stroke + 0.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'chevron-down' ? (
        <Path
          d="M6 9l6 6 6-6"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'chevron-right' ? (
        <Path
          d="M9 18l6-6-6-6"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'sparkles' ? (
        <Path
          d="m12 3-1.9 5.6a2 2 0 0 1-1.3 1.3L3.2 12l5.6 1.9a2 2 0 0 1 1.3 1.3L12 20.8l1.9-5.6a2 2 0 0 1 1.3-1.3L20.8 12l-5.6-1.9a2 2 0 0 1-1.3-1.3L12 3Z"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
          fillOpacity={filled ? 0.2 : 0}
        />
      ) : null}
      {name === 'server' ? (
        <>
          <Path
            d="M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Zm0 11a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3Z"
            stroke={color}
            strokeWidth={stroke}
          />
          <Path d="M6 6.5h.01M6 17.5h.01" stroke={color} strokeWidth={stroke + 1} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'palette' ? (
        <Path
          d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 17 7.1c.4-.4.6-.9.6-1.5 0-1.1-.9-2-2-2h-1.6c-.6 0-1-.4-1-1 0-.3.1-.5.3-.7l1.7-2c.6-.7.9-1.6.9-2.5C18.9 5.5 15.8 2 12 2Z"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  );
}
