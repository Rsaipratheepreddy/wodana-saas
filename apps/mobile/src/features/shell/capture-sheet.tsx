import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Camera, ClipboardList, HardHat, MessageSquarePlus, PackageCheck, PhoneCall, ReceiptText, Ruler, TriangleAlert, UserPlus, type LucideIcon } from 'lucide-react-native';
import { captureActions, type CaptureAction } from '../../core/access';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { deferred } from '../../ui/sequence';
import { Sheet } from '../../ui/sheet';
import { IconBadge, Text } from '../../ui/primitives';
import { Empty } from '../../ui/layout';
import { useTheme } from '../../ui/theme';

const ACTIONS: Record<CaptureAction, { label: string; icon: LucideIcon; href: Href }> = {
  photo: { label: key('Site photo'), icon: Camera, href: '/capture/photo' },
  report: { label: key('Daily report'), icon: ClipboardList, href: '/capture/pick/report' },
  'crew-day': { label: key('Crew day'), icon: HardHat, href: '/capture/pick/crew-day' },
  snag: { label: key('Raise snag'), icon: TriangleAlert, href: '/capture/pick/snag' },
  measurement: { label: key('Measurement'), icon: Ruler, href: '/capture/measure' },
  delivery: { label: key('Receive delivery'), icon: PackageCheck, href: '/purchasing' },
  enquiry: { label: key('New enquiry'), icon: UserPlus, href: '/sales/new' },
  note: { label: key('Log a call'), icon: PhoneCall, href: '/capture/note' },
  'follow-up': { label: key('Follow-up'), icon: MessageSquarePlus, href: '/capture/follow-up' },
  expense: { label: key('Expense'), icon: ReceiptText, href: '/capture/pick/expense' },
};

const Context = createContext<{ open: () => void }>({ open: () => undefined });
export const useCapture = () => useContext(Context);

/** The + button: the quick captures this person can make, as a grid of big targets. */
export function CaptureProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return <Context.Provider value={value}>
    {children}
    <CaptureSheet open={open} onClose={() => setOpen(false)} />
  </Context.Provider>;
}

function CaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const session = useSession();
  const actions = captureActions(session);
  // The chosen capture opens once the sheet has gone: its screen may open the camera straight away.
  const [chosen] = useState(deferred);
  return <Sheet open={open} onClose={onClose} onClosed={chosen.run} title={t('Capture')}>
    {actions.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) }}>
      {actions.map((action) => {
        const item = ACTIONS[action];
        return <Pressable key={action} accessibilityRole="button" accessibilityLabel={t(item.label)}
          onPress={() => { haptic.tap(); chosen.set(() => router.push(item.href)); onClose(); }}
          style={({ pressed }) => ({ width: '31.5%', flexGrow: 1, minHeight: 96, borderRadius: theme.radius.lg, padding: theme.space(3), gap: theme.space(2), justifyContent: 'space-between',
            backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceMuted })}>
          <IconBadge icon={item.icon} tone="action" size={40} />
          <Text variant="label" numberOfLines={2}>{t(item.label)}</Text>
        </Pressable>;
      })}
    </View> : <Empty title={t('Nothing to capture here')} detail={t('Ask your administrator for access to projects or sales.')} />}
  </Sheet>;
}
