/* eslint-disable @next/next/no-img-element */
/** next/image outside Next (the sample harness): a plain image. */
export default function Image({ src, alt, width, height, unoptimized: _unoptimized, ...rest }: { src: string; alt: string; width?: number; height?: number; unoptimized?: boolean; className?: string }) {
  return <img src={src} alt={alt} width={width} height={height} {...rest} />;
}
