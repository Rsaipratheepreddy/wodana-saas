import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Text } from './primitives';
import { useTheme } from './theme';

const wodanaLogo = require('../../assets/brand/wodana-logo-v4.png');

/**
 * The organisation's logo when it has one; otherwise its name set in type. Wodana's own logo shows only
 * before an organisation is chosen.
 */
export function BrandLogo({ logoUrl, name, width = 150 }: { logoUrl?: string | null; name?: string | null; width?: number }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [logoUrl]);
  if (logoUrl && !failed) {
    return <Image source={{ uri: logoUrl }} onError={() => setFailed(true)} contentFit="contain" contentPosition="left"
      accessibilityLabel={name ?? undefined} style={{ width, height: Math.round(width / 3) }} transition={120} />;
  }
  if (name) return <Text variant="heading" numberOfLines={2} style={{ maxWidth: width * 1.6, fontSize: theme.size.xl }} accessibilityRole="header">{name}</Text>;
  return <Image source={wodanaLogo} contentFit="contain" contentPosition="left" accessibilityLabel="Wodana" style={{ width, height: Math.round(width / 3) }}
    tintColor={theme.scheme === 'dark' ? theme.colors.text : undefined} />;
}
