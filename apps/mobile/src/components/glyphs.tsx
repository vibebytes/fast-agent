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
  | 'bolt'
  | 'server'
  | 'palette'
  | 'arrow-up'
  | 'alert'
  | 'brief'
  | 'full'
  | 'globe'
  | 'user'
  | 'qr'
  | 'link'
  | 'copy'
  | 'arrow-down'
  | 'search'
  | 'info';

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
          d="M12 3c5.25 0 9.5 3.9 9.5 8.7 0 4.8-4.25 8.7-9.5 8.7a10.4 10.4 0 0 1-3.6-.64L4 21l1.32-3.8A8.4 8.4 0 0 1 2.5 11.7C2.5 6.9 6.75 3 12 3Z"
          stroke={color}
          strokeWidth={filled ? 0 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
        />
      ) : null}
      {name === 'history' ? (
        filled ? (
          <>
            <Circle cx="12" cy="12" r="9" fill={color} />
            <Path
              d="M12 7.2v4.8l3 2"
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <Circle cx="12" cy="12.5" r="7.5" stroke={color} strokeWidth={1.8} />
            <Path
              d="M12 9.2v3.3l2.3 1.5"
              stroke={color}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )
      ) : null}
      {name === 'settings' ? (
        filled ? (
          <Path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm7.4 3c.06.52.06 1.08 0 1.6l1.7 1.3a.6.6 0 0 1 .15.77l-1.6 2.8a.6.6 0 0 1-.74.26l-2-.8a7.8 7.8 0 0 1-1.4.8l-.3 2.1a.6.6 0 0 1-.6.5h-3.2a.6.6 0 0 1-.6-.5l-.3-2.1a7.8 7.8 0 0 1-1.4-.8l-2 .8a.6.6 0 0 1-.74-.26L4.75 14.87a.6.6 0 0 1 .15-.77l1.7-1.3a8.2 8.2 0 0 1 0-1.6l-1.7-1.3a.6.6 0 0 1-.15-.77l1.6-2.8a.6.6 0 0 1 .74-.26l2 .8c.44-.33.9-.6 1.4-.8l.3-2.1a.6.6 0 0 1 .6-.5h3.2a.6.6 0 0 1 .6.5l.3 2.1c.5.2.96.47 1.4.8l2-.8a.6.6 0 0 1 .74.26l1.6 2.8a.6.6 0 0 1-.15.77l-1.7 1.3Z"
            fill={color}
          />
        ) : (
          <Path
            d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm7.2 3.1c0-.3-.2-.7-.4-1l1.3-1.5-1.6-2.8-2 .5c-.3-.2-.7-.4-1.1-.5l-.4-2H9l-.4 2c-.4.1-.8.3-1.1.5l-2-.5-1.6 2.8 1.3 1.5c-.2.3-.4.7-.4 1s.2.7.4 1L4 15.7l1.6 2.8 2-.5c.3.2.7.4 1.1.5l.4 2h4.2l.4-2c.4-.1.8-.3 1.1-.5l2 .5 1.6-2.8-1.3-1.5c.2-.3.4-.7.4-1Z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
        )
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
      {name === 'bolt' ? (
        <Path
          d="M13.5 2.5 4.8 12.8c-.4.5-.1 1.2.6 1.2h5.8l-1.6 7.5c-.3.7.6 1.2 1.1.6l8.7-10.3c.4-.5.1-1.2-.6-1.2h-5.8l1.6-7.5c.3-.7-.6-1.2-1.1-.6Z"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : 'none'}
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
      {name === 'arrow-up' ? (
        <Path
          d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
          stroke={color}
          strokeWidth={stroke + 0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'alert' ? (
        <>
          <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={stroke} />
          <Path d="M12 7.8v5M12 16.2h.01" stroke={color} strokeWidth={stroke + 0.4} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'brief' ? (
        <Path
          d="M6 8.5h12M6 12h8M6 15.5h10"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      ) : null}
      {name === 'full' ? (
        <Path
          d="M5 6h14M5 9.5h14M5 13h14M5 16.5h14M5 20h9"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
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
      {name === 'globe' ? (
        <>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={stroke} />
          <Path
            d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>
      ) : null}
      {name === 'user' ? (
        <>
          <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={stroke} />
          <Path
            d="M5 20a7 7 0 0 1 14 0"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>
      ) : null}
      {name === 'qr' ? (
        <>
          <Path
            d="M3.2 3.2h6.6v6.6H3.2zM14.2 3.2h6.6v6.6h-6.6zM3.2 14.2h6.6v6.6H3.2z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5.6 5.6h1.8v1.8H5.6zM16.6 5.6h1.8v1.8h-1.8zM5.6 16.6h1.8v1.8H5.6z"
            fill={color}
          />
          <Path
            d="M14.2 14.2h3v3h-3zM18.2 18.2h2.6v2.6h-2.6zM18.2 14.2h2.6v1.8h-2.6zM14.2 18.2h1.8v2.6h-1.8z"
            fill={color}
          />
        </>
      ) : null}
      {name === 'link' ? (
        <Path
          d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'copy' ? (
        <>
          <Path
            d="M9 15h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5 9v10a2 2 0 0 0 2 2h10"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {name === 'arrow-down' ? (
        <Path
          d="M12 5v14M19 12l-7 7-7-7"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'search' ? (
        <>
          <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={1.8} />
          <Path d="m20 20-3.5-3.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'info' ? (
        <>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={stroke} />
          <Path
            d="M12 16v-4M12 8h.01"
            stroke={color}
            strokeWidth={stroke + 0.3}
            strokeLinecap="round"
          />
        </>
      ) : null}
    </Svg>
  );
}
