import { Image, type ImageProps } from 'react-native';

export const brandLogoSource = require('../../assets/brand/wodana-logo-v4.png');
export const brandMarkSource = require('../../assets/brand/woddy-mark-v4.png');

export function BrandLogo({ width = 232, style, ...props }: Omit<ImageProps, 'source'> & { width?: number }) {
  return <Image {...props} source={brandLogoSource} resizeMode="contain"
    accessible accessibilityRole="image" accessibilityLabel="Wodana"
    fadeDuration={0} style={[{ width, height: width / 3 }, style]} />;
}
