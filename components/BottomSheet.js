import { useMemo } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { formatDistance, formatArea } from '../lib/geo';
import { useTheme } from '../theme/ThemeProvider';

const formatTime = (secs) => {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// The floating bottom overlay: toast stack (loop / domination / captured area /
// save status) + the stats card with the Start/Stop button.
export default function BottomSheet({
  isRunning, elapsedSeconds, totalDistance, location,
  loopDetected, dominationMsg, area, saveStatus,
  onStart, onStop,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.bottomWrap} pointerEvents="box-none">

      {/* Toasts stack */}
      {loopDetected && (
        <BlurView intensity={80} tint={theme.blurTint} style={[styles.toast, styles.toastSuccess]}>
          <Text style={[styles.toastText, styles.toastTextSuccess]}>🎯 Loop detected! Territory captured!</Text>
        </BlurView>
      )}
      {dominationMsg !== '' && (
        <BlurView intensity={80} tint={theme.blurTint} style={[styles.toast, styles.toastGold]}>
          <Text style={styles.toastText}>{dominationMsg}</Text>
        </BlurView>
      )}
      {area !== null && (
        <BlurView intensity={80} tint={theme.blurTint} style={[styles.toast, styles.toastIndigo]}>
          <View>
            <Text style={styles.areaLabel}>TERRITORY CAPTURED</Text>
            <Text style={styles.areaValue}>{formatArea(area)}</Text>
          </View>
          <Text style={styles.areaEmoji}>🏴</Text>
        </BlurView>
      )}
      {saveStatus !== '' && (
        <BlurView intensity={80} tint={theme.blurTint} style={[styles.toast, saveStatus.includes('failed') ? styles.toastError : styles.toastSuccess]}>
          <Text style={[styles.toastText, saveStatus.includes('failed') ? styles.toastTextError : styles.toastTextSuccess]}>
            {saveStatus}
          </Text>
        </BlurView>
      )}

      <BlurView intensity={85} tint={theme.blurTint} style={styles.sheet}>
        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{formatTime(elapsedSeconds)}</Text>
            <Text style={styles.statLabel}>TIME</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{formatDistance(totalDistance)}</Text>
            <Text style={styles.statLabel}>DISTANCE</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statValue}>
              {location ? `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}` : '—'}
            </Text>
            <Text style={styles.statLabel}>POSITION</Text>
          </View>
        </View>

        {!isRunning ? (
          <TouchableOpacity
            style={styles.startButton}
            onPress={onStart}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Start run"
          >
            <Text style={styles.startButtonText}>Start Run</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={onStop}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Stop run"
          >
            <Text style={styles.stopButtonText}>Stop Run</Text>
          </TouchableOpacity>
        )}
      </BlurView>
    </View>
  );
}

const createStyles = (t) => {
  const SHADOW = Platform.select({
    ios: {
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
    },
    android: { elevation: 6 },
  });

  return StyleSheet.create({
    bottomWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 14,
      paddingBottom: Platform.OS === 'ios' ? 110 : 96,
    },
    sheet: {
      borderRadius: 28,
      padding: 18,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.mapOverlayStrong,
      ...SHADOW,
    },

    // Stats inside sheet
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    statCol: {
      flex: 1,
      alignItems: 'center',
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      height: 30,
      backgroundColor: t.divider,
    },
    statValue: {
      fontSize: 17,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.3,
    },
    statLabel: {
      fontSize: 9,
      color: t.textDim,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginTop: 4,
    },

    // Buttons
    startButton: {
      backgroundColor: t.primary,
      paddingVertical: 17,
      borderRadius: 18,
      alignItems: 'center',
      shadowColor: t.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 14,
      elevation: 6,
    },
    startButtonText: {
      color: t.onPrimary,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    stopButton: {
      backgroundColor: t.danger,
      paddingVertical: 17,
      borderRadius: 18,
      alignItems: 'center',
      shadowColor: t.danger,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 14,
      elevation: 6,
    },
    stopButtonText: {
      color: t.onPrimary,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.3,
    },

    // ── Toasts ──
    toast: {
      borderRadius: 18,
      padding: 14,
      marginBottom: 10,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.mapOverlayStrong,
      ...SHADOW,
    },
    toastText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.textStrong,
    },
    toastGold: { backgroundColor: t.toastGold },
    toastIndigo: { backgroundColor: t.toastIndigo },
    toastSuccess: { backgroundColor: t.toastSuccess },
    toastError: { backgroundColor: t.toastError },
    toastTextSuccess: { color: t.successText },
    toastTextError: { color: t.dangerText },

    areaLabel: {
      fontSize: 9,
      color: t.primary,
      fontWeight: '800',
      letterSpacing: 0.8,
      marginBottom: 3,
    },
    areaValue: {
      fontSize: 22,
      fontWeight: '800',
      color: t.primaryStrong,
      letterSpacing: -0.5,
    },
    areaEmoji: { fontSize: 28 },
  });
};
