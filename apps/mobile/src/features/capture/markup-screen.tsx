import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as NativeImage, PanResponder, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { ArrowUpRight, Pen, Trash2, Type, Undo2, X } from 'lucide-react-native';
import { haptic } from '../../core/haptics';
import { useT } from '../../core/i18n';
import { preparePhoto } from '../../core/media';
import { TextField } from '../../ui/fields';
import { Button, IconButton, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { flattenMarkup } from './flatten';
import { markupBus } from './markup-bus';
import { addPoint, arrowPath, fit, MARK_COLORS, MARK_WIDTHS, normalise, penPath, type Mark, type Point } from './markup-model';

type Tool = 'pen' | 'arrow' | 'text';

/** Draw on a photo: freehand pen, arrows and labels in a few strong colours, with undo; saved as a new photo. */
export function MarkupScreen() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ uri: string; key: string; width?: string; height?: string }>();
  const [size, setSize] = useState({ width: Number(params.width) || 0, height: Number(params.height) || 0 });
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [marks, setMarks] = useState<Mark[]>([]);
  const [live, setLive] = useState<Mark | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(MARK_COLORS[0]);
  const [thick, setThick] = useState(false);
  const [labelAt, setLabelAt] = useState<Point | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const shot = useRef<View>(null);
  const settings = useRef({ tool, color, thick, box: { width: 0, height: 0 } });

  useEffect(() => {
    if (size.width || !params.uri) return;
    NativeImage.getSize(params.uri, (width, height) => setSize({ width, height }), () => setSize({ width: 3, height: 4 }));
  }, [params.uri, size.width]);
  const box = fit(size.width, size.height, frame.width, frame.height);
  settings.current = { tool, color, thick, box };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { tool: current, color: ink, thick: heavy, box: area } = settings.current;
      const point = normalise(event.nativeEvent.locationX, event.nativeEvent.locationY, area.width, area.height);
      if (current === 'text') { setLabelAt(point); return; }
      const width = heavy ? MARK_WIDTHS.thick : MARK_WIDTHS.thin;
      setLive(current === 'pen' ? { kind: 'pen', color: ink, width, points: [point] } : { kind: 'arrow', color: ink, width, from: point, to: point });
    },
    onPanResponderMove: (event) => {
      const area = settings.current.box;
      const point = normalise(event.nativeEvent.locationX, event.nativeEvent.locationY, area.width, area.height);
      setLive((mark) => (!mark ? mark : mark.kind === 'pen' ? { ...mark, points: addPoint(mark.points, point) } : mark.kind === 'arrow' ? { ...mark, to: point } : mark));
    },
    onPanResponderRelease: () => {
      setLive((mark) => {
        if (mark && (mark.kind !== 'arrow' || Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) > 0.02)) { setMarks((list) => [...list, mark]); haptic.tap(); }
        return null;
      });
    },
  }), []);

  const save = async () => {
    if (!marks.length) { router.back(); return; }
    setSaving(true);
    try {
      const flat = await flattenMarkup({ ref: shot, uri: params.uri, width: size.width, height: size.height, marks });
      const photo = await preparePhoto(flat.uri, flat.width, flat.height);
      markupBus.deliver(params.key, photo);
      haptic.success();
      router.back();
    } catch { toast.error(t('The drawing could not be saved. Try again.')); }
    finally { setSaving(false); }
  };

  const draw = (mark: Mark, index: number | string) => {
    if (mark.kind === 'pen') return <Path key={index} d={penPath(mark.points, box.width, box.height)} stroke={mark.color} strokeWidth={mark.width * box.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    if (mark.kind === 'arrow') return <Path key={index} d={arrowPath(mark, box.width, box.height)} stroke={mark.color} strokeWidth={mark.width * box.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
    return <SvgText key={index} x={mark.at.x * box.width} y={mark.at.y * box.height} fill={mark.color} stroke={mark.color === '#111111' ? '#FFFFFF' : '#000000'} strokeWidth={1}
      fontSize={mark.size * box.width} fontWeight="600">{mark.text}</SvgText>;
  };

  return <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, theme.space(3)) }}>
    <StatusBar style="light" />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space(2), height: 56 }}>
      <IconButton icon={X} label={t('Close')} tone="inverse" onPress={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
        <IconButton icon={Undo2} label={t('Undo')} tone="inverse" disabled={!marks.length} onPress={() => setMarks((list) => list.slice(0, -1))} />
        <IconButton icon={Trash2} label={t('Clear')} tone="inverse" disabled={!marks.length} onPress={() => setMarks([])} />
      </View>
      <Button label={t('Done')} variant="primary" size="sm" pill loading={saving} onPress={save} />
    </View>

    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(event) => setFrame({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      {box.width ? <View ref={shot} collapsable={false} style={{ width: box.width, height: box.height }}>
        <Image source={{ uri: params.uri }} style={{ width: box.width, height: box.height }} contentFit="fill" />
        <View {...responder.panHandlers} style={{ position: 'absolute', top: 0, start: 0, width: box.width, height: box.height }}>
          <Svg width={box.width} height={box.height} pointerEvents="none">
            {marks.map(draw)}
            {live ? draw(live, 'live') : null}
          </Svg>
        </View>
      </View> : null}
    </View>

    <View style={{ gap: theme.space(3), paddingHorizontal: theme.space(4), paddingTop: theme.space(3) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space(3) }}>
        {MARK_COLORS.map((swatch) => <Pressable key={swatch} accessibilityRole="button" accessibilityLabel={t('Colour')} accessibilityState={{ selected: swatch === color }}
          onPress={() => { haptic.tap(); setColor(swatch); }} hitSlop={6}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: swatch, borderWidth: swatch === color ? 3 : 1.5, borderColor: swatch === color ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space(2) }}>
        {([['pen', Pen, t('Pen')], ['arrow', ArrowUpRight, t('Arrow')], ['text', Type, t('Text')]] as const).map(([value, Icon, name]) => <Pressable key={value}
          accessibilityRole="button" accessibilityState={{ selected: tool === value }} accessibilityLabel={name} onPress={() => { haptic.tap(); setTool(value); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2), height: 44, paddingHorizontal: theme.space(4), borderRadius: 22, backgroundColor: tool === value ? '#FFFFFF' : 'rgba(255,255,255,0.12)' }}>
          <Icon color={tool === value ? '#000000' : '#FFFFFF'} size={18} />
          <Text variant="label" style={{ color: tool === value ? '#000000' : '#FFFFFF' }}>{name}</Text>
        </Pressable>)}
        {tool !== 'text' ? <Pressable accessibilityRole="button" accessibilityLabel={thick ? t('Thin line') : t('Thick line')} onPress={() => { haptic.tap(); setThick((value) => !value); }}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
          <View style={{ width: thick ? 16 : 8, height: thick ? 16 : 8, borderRadius: 8, backgroundColor: color }} />
        </Pressable> : null}
      </View>
    </View>

    <Sheet open={!!labelAt} onClose={() => { setLabelAt(null); setLabel(''); }} title={t('Add a label')}
      footer={<Button label={t('Add')} variant="primary" size="lg" full disabled={!label.trim()} onPress={() => {
        if (labelAt) setMarks((list) => [...list, { kind: 'text', color, text: label.trim().slice(0, 60), at: labelAt, size: 0.05 }]);
        setLabelAt(null); setLabel('');
      }} />}>
      <TextField value={label} onChangeText={setLabel} autoFocus maxLength={60} placeholder={t('e.g. Move socket 20 cm')} />
    </Sheet>
  </View>;
}
