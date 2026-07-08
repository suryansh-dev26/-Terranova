import { useMemo } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';

const TAB_ICONS = {
  Home: { active: '🗺️', label: 'Map' },
  History: { active: '🕑', label: 'Activity' },
  Leaderboard: { active: '🏆', label: 'Ranks' },
  Profile: { active: '👤', label: 'Me' },
};

// Instagram-style floating tab bar.
export default function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <BlurView intensity={90} tint={theme.blurTint} style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = TAB_ICONS[route.name] ?? { active: '•', label: route.name };
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <TouchableOpacity
              key={route.key}
              activeOpacity={0.7}
              onPress={onPress}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected: focused }}
            >
              <View style={[styles.iconPill, focused && styles.iconPillActive]}>
                <Text style={[styles.icon, !focused && styles.iconDim]}>{meta.active}</Text>
              </View>
              <Text style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
            </TouchableOpacity>
          );
        })}
      </BlurView>
    </View>
  );
}

const createStyles = (t) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 30,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 380,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.mapOverlayStrong,
    shadowColor: t.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  iconPill: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillActive: {
    backgroundColor: t.primaryFaint,
  },
  icon: { fontSize: 18 },
  iconDim: { opacity: 0.45 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: t.primary,
  },
});
