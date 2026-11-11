import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gradients } from '../../config/theme';

// The app icon's mesh constellation, drawn live: the crew's nodes appear, the
// mesh links fade in, then the two bright nodes connect with a sunset line —
// the product in two seconds. After that only the two nodes breathe, slowly.
// Coordinates are the icon's, cropped to the constellation (1100 × 910).

const W = 1100;
const H = 910;
const OX = 400;
const OY = 340;

type Node = { x: number; y: number; r: number };
const A: Node = { x: 717, y: 698, r: 64 };
const B: Node = { x: 1170, y: 811, r: 53 };
const NODES: Node[] = [
  { x: 868, y: 368, r: 28 }, { x: 509, y: 452, r: 19 }, { x: 641, y: 546, r: 17 },
  { x: 1283, y: 462, r: 15 }, { x: 1396, y: 641, r: 22 }, { x: 1471, y: 848, r: 10 },
  { x: 433, y: 773, r: 13 }, { x: 585, y: 1018, r: 24 }, { x: 1000, y: 1056, r: 21 },
  { x: 1321, y: 1018, r: 17 }, { x: 1113, y: 1188, r: 15 }, { x: 849, y: 1226, r: 11 },
];
const N = (i: number) => NODES[i];
const EDGES: [Node, Node][] = [
  [N(1), N(0)], [N(0), N(3)], [N(1), N(2)], [N(1), A], [N(2), A], [N(2), N(6)], [N(6), A],
  [N(0), A], [N(0), B], [N(3), B], [B, N(4)], [N(4), N(5)], [N(4), N(9)], [B, N(9)],
  [B, N(8)], [A, N(7)], [N(6), N(7)], [N(7), N(8)], [N(8), N(9)], [N(8), N(10)],
  [N(8), N(11)], [N(11), N(10)], [N(10), N(9)],
];

interface Props {
  size?: number; // width in points
}

export default function ConstellationLogo({ size = 240 }: Props) {
  const k = size / W;
  const height = H * k;
  const nodesIn = useSharedValue(0);
  const edgesIn = useSharedValue(0);
  const link = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    nodesIn.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    edgesIn.value = withDelay(350, withTiming(1, { duration: 700 }));
    link.value = withDelay(900, withTiming(1, { duration: 650, easing: Easing.inOut(Easing.cubic) }));
    breathe.value = withDelay(1600, withRepeat(withSequence(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
    ), -1));
  }, []);

  const px = (n: Node) => ({ x: (n.x - OX) * k, y: (n.y - OY) * k, r: n.r * k });

  return (
    <View style={{ width: size, height }} accessibilityRole="image" accessibilityLabel="RNDVU">
      {EDGES.map(([p, q], i) => <Edge key={i} a={px(p)} b={px(q)} progress={edgesIn} />)}
      {NODES.map((n, i) => <Dot key={i} n={px(n)} progress={nodesIn} delay={i / NODES.length} />)}
      <Link a={px(A)} b={px(B)} progress={link} />
      <Hero n={px(A)} color={Gradients.sunset[0]} progress={nodesIn} breathe={breathe} />
      <Hero n={px(B)} color={Gradients.sunset[2]} progress={nodesIn} breathe={breathe} />
    </View>
  );
}

type P = { x: number; y: number; r: number };

function lineGeometry(a: P, b: P) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { len: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

function Edge({ a, b, progress }: { a: P; b: P; progress: SharedValue<number> }) {
  const { len, angle } = lineGeometry(a, b);
  const style = useAnimatedStyle(() => ({ opacity: progress.value * 0.35 }));
  return (
    <Animated.View
      style={[styles.line, {
        left: a.x, top: a.y, width: len, height: StyleSheet.hairlineWidth * 2,
        transform: [{ rotate: `${angle}rad` }], transformOrigin: 'left center',
      }, style]}
    />
  );
}

function Link({ a, b, progress }: { a: P; b: P; progress: SharedValue<number> }) {
  const { len, angle } = lineGeometry(a, b);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle}rad` }, { scaleX: progress.value }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: a.x, top: a.y - 1.5, width: len, height: 3, transformOrigin: 'left center' }, style]}>
      <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1, borderRadius: 2 }} />
    </Animated.View>
  );
}

function Dot({ n, progress, delay }: { n: P; progress: SharedValue<number>; delay: number }) {
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (progress.value - delay * 0.5) * 2));
    return { opacity: t * 0.75, transform: [{ scale: 0.4 + 0.6 * t }] };
  });
  return <Animated.View style={[styles.dot, { left: n.x - n.r, top: n.y - n.r, width: n.r * 2, height: n.r * 2, borderRadius: n.r }, style]} />;
}

function Hero({ n, color, progress, breathe }: { n: P; color: string; progress: SharedValue<number>; breathe: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: (0.5 + 0.5 * progress.value) * (1 + 0.04 * breathe.value) }],
    shadowOpacity: 0.55 + 0.3 * breathe.value,
  }));
  return (
    <Animated.View
      style={[{
        position: 'absolute', left: n.x - n.r, top: n.y - n.r, width: n.r * 2, height: n.r * 2,
        borderRadius: n.r, backgroundColor: color,
        shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowRadius: n.r * 1.4,
      }, style]}
    />
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', backgroundColor: '#ffb08a' },
  dot: { position: 'absolute', backgroundColor: '#d98a64' },
});
