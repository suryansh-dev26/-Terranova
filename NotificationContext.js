import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Animated, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const DEFAULT_DURATION_MS = 4000;

const NotificationContext = createContext(null);

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used inside <NotificationProvider>');
  return ctx;
}

let idCounter = 0;
const nextId = () => `n_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;

export function NotificationProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => {
    setItems(prev => prev.filter(n => n.id !== id));
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    const id = nextId();
    const duration = opts.duration ?? DEFAULT_DURATION_MS;
    setItems(prev => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const notify = useMemo(() => ({
    success: (msg, opts) => push('success', msg, opts),
    error:   (msg, opts) => push('error',   msg, opts),
    warning: (msg, opts) => push('warning', msg, opts),
    info:    (msg, opts) => push('info',    msg, opts),
    dismiss,
  }), [push, dismiss]);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationContainer items={items} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

function NotificationContainer({ items, onDismiss }) {
  if (items.length === 0) return null;
  return (
    <SafeAreaView
      pointerEvents="box-none"
      style={styles.container}
      edges={['top']}
    >
      {items.map(n => (
        <NotificationCard key={n.id} item={n} onDismiss={onDismiss} />
      ))}
    </SafeAreaView>
  );
}

function NotificationCard({ item, onDismiss }) {
  const translateY = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissedRef = useRef(false);

  const animateOut = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 0,   duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -24, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss(item.id));
  }, [opacity, translateY, onDismiss, item.id]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }),
    ]).start();
    if (item.duration > 0) {
      const t = setTimeout(animateOut, item.duration);
      return () => clearTimeout(t);
    }
  }, [opacity, translateY, animateOut, item.duration]);

  const palette = PALETTES[item.type] ?? PALETTES.info;
  const isError = item.type === 'error';

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity, transform: [{ translateY }] },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
      importantForAccessibility="yes"
    >
      <Text style={[styles.icon, { color: palette.fg }]}>{palette.icon}</Text>
      <Text style={[styles.message, { color: palette.fg }]} numberOfLines={3}>
        {item.message}
      </Text>
      <TouchableOpacity
        onPress={animateOut}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        style={styles.closeBtn}
      >
        <Text style={[styles.closeGlyph, { color: palette.fg }]}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const PALETTES = {
  success: { bg: '#dcfce7', border: '#86efac', fg: '#166534', icon: '✓' },
  error:   { bg: '#fee2e2', border: '#fca5a5', fg: '#991b1b', icon: '⚠' },
  warning: { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e', icon: '!' },
  info:    { bg: '#dbeafe', border: '#93c5fd', fg: '#1e40af', icon: 'i' },
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 14,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 440,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  icon: {
    fontSize: 16,
    fontWeight: '800',
    marginRight: 10,
    width: 18,
    textAlign: 'center',
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  closeBtn: {
    marginLeft: 10,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
  },
});
