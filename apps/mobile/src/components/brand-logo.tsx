import { useEffect, useState } from 'react';
import { Image, Text, type ImageProps } from 'react-native';

export const brandLogoSource = require('../../assets/brand/wodana-logo-v4.png');
export const brandMarkSource = require('../../assets/brand/woddy-mark-v4.png');
export const palmLivingLogoSource = require('../../assets/brand/palm-living-logo.png');
export const palmLivingMarkSource = require('../../assets/brand/palm-living-monogram.png');

export function BrandLogo({ width = 232, tenantSlug, logoUri, displayName, mark = false, style, onError, ...props }: Omit<ImageProps, 'source'> & {
  width?: number;
  tenantSlug?: string;
  logoUri?: string | null;
  displayName?: string;
  mark?: boolean;
}) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  useEffect(() => { setRemoteFailed(false); }, [logoUri]);
  const palmLiving = tenantSlug === 'palm-living';
  const fallback = palmLiving ? (mark ? palmLivingMarkSource : palmLivingLogoSource) : (mark ? brandMarkSource : brandLogoSource);
  const source = logoUri && !remoteFailed ? { uri: logoUri } : fallback;
  if (displayName && !palmLiving && (!logoUri || remoteFailed)) {
    return <Text accessibilityRole="text" style={{ maxWidth: width, color: '#2b1932', fontSize: Math.max(20, width / 7), fontWeight: '600' }} numberOfLines={2}>{displayName}</Text>;
  }
  return <Image {...props} source={source} resizeMode="contain" onError={(event) => { setRemoteFailed(true); onError?.(event); }}
    accessible accessibilityRole="image" accessibilityLabel={displayName ?? (palmLiving ? 'Palm Living' : 'Wodana')}
    fadeDuration={0} style={[{ width, height: mark ? width : palmLiving ? width / 2.6 : width / 3 }, style]} />;
}
