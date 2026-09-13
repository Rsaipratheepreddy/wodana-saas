import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { tokens } from '../design-system';

export type IconName = 'mail' | 'arrow-right' | 'arrow-up-right' | 'arrow-left' | 'close' | 'eye' | 'eye-off' | 'lock'
  | 'home' | 'inbox' | 'search' | 'plus' | 'bell' | 'profile' | 'crm' | 'pre-project' | 'projects' | 'hrms'
  | 'chevron-down' | 'chevron-right' | 'more' | 'check' | 'calendar' | 'clock' | 'camera' | 'location' | 'phone';

export function Icon({ name, size = 20, color = tokens.brand.ink, filled = false }: { name: IconName; size?: number; color?: string; filled?: boolean }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}
    style={{ pointerEvents: 'none' }}>
    {name === 'mail' && <><Rect x="3" y="5" width="18" height="14" rx="3" /><Path d="m4 7 8 6 8-6" /></>}
    {name === 'arrow-right' && <Path d="M5 12h14m-6-6 6 6-6 6" />}
    {name === 'arrow-up-right' && <Path d="M6 18 18 6M6 6h12v12" />}
    {name === 'arrow-left' && <Path d="M19 12H5m6-6-6 6 6 6" />}
    {name === 'close' && <Path d="m6 6 12 12M6 18 18 6" />}
    {name === 'chevron-down' && <Path d="m6 9 6 6 6-6" />}
    {name === 'chevron-right' && <Path d="m9 6 6 6-6 6" />}
    {name === 'more' && <><Circle cx="5" cy="12" r="1" fill={color} stroke="none" /><Circle cx="12" cy="12" r="1" fill={color} stroke="none" /><Circle cx="19" cy="12" r="1" fill={color} stroke="none" /></>}
    {name === 'check' && <Path d="m5 12 4 4L19 6" />}
    {name === 'calendar' && <><Rect x="3" y="5" width="18" height="16" rx="3" /><Path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>}
    {name === 'clock' && <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></>}
    {name === 'camera' && <><Path d="M8 5 6 8H4a2 2 0 0 0-2 2v9h20v-9a2 2 0 0 0-2-2h-2l-2-3Z" /><Circle cx="12" cy="13" r="3" /></>}
    {name === 'location' && <><Path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><Circle cx="12" cy="10" r="2.5" /></>}
    {name === 'phone' && <Path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-1.3 2.2a14 14 0 0 1-7.9-7.9L9 8Z" />}
    {(name === 'eye' || name === 'eye-off') && <>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <Circle cx="12" cy="12" r="3" />
      {name === 'eye-off' && <Path d="m3 3 18 18" />}
    </>}
    {name === 'lock' && <><Rect x="5" y="10" width="14" height="11" rx="3" /><Path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>}
    {/* Navigation outlines share an 18-unit optical size and the same stroke. */}
    {name === 'home' && <Path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill={filled ? color : 'none'} />}
    {name === 'inbox' && <>
      <Path d="M3 11 6 4h12l3 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <Path d="M3 11h5l2 3h4l2-3h5" />
    </>}
    {name === 'search' && <><Circle cx="10.5" cy="10.5" r="6.5" /><Path d="m15.5 15.5 4.5 4.5" /></>}
    {name === 'plus' && <Path d="M12 3v18M3 12h18" />}
    {name === 'bell' && <><Path d="M5 16V10a7 7 0 0 1 14 0v6l2 2H3l2-2Z" /><Path d="M10 21h4" /></>}
    {name === 'profile' && <><Circle cx="12" cy="7" r="4" /><Path d="M4 21a8 7 0 0 1 16 0" /></>}
    {name === 'crm' && <>
      <Rect x="4" y="7" width="16" height="13" rx="2.2" />
      <Path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M4 12.5a20 20 0 0 0 6 1.8m4 0a20 20 0 0 0 6-1.8" />
      <Rect x="10" y="12.5" width="4" height="3.5" rx="0.7" />
    </>}
    {name === 'pre-project' && <>
      <Rect x="4" y="3.5" width="16" height="17" rx="2" />
      <Path d="M10 3.5v7h10M4 14h6v6.5" />
    </>}
    {name === 'projects' && <>
      <Path d="M4 8V6a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <Path d="M8 11v6M12 11v3M16 11v5" />
    </>}
    {name === 'hrms' && <>
      <Circle cx="12" cy="8" r="2.5" />
      <Path d="M7 20v-2a5 5 0 0 1 10 0v2M5 7a2 2 0 0 0 0 4m14-4a2 2 0 0 1 0 4M3 20v-2a4 4 0 0 1 2-3.46M21 20v-2a4 4 0 0 0-2-3.46" />
    </>}
  </Svg>;
}
