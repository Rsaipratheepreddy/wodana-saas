import type { ComponentProps } from 'react';
import { useFormat } from '../core/format';
import { Text } from './primitives';

/** An amount in the workspace's currency (or the record's own), with that currency's decimals and tabular figures. */
export function MoneyText({ amount, currency, ...props }: { amount: string | number | null | undefined; currency?: string | null } & Omit<ComponentProps<typeof Text>, 'children'>) {
  const format = useFormat();
  return <Text variant="label" {...props} style={[{ fontVariant: ['tabular-nums'] }, props.style]}>{format.money(amount, currency ?? undefined)}</Text>;
}
