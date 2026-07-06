import { Component, Fragment } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Top-level catch-all so a render error anywhere shows a friendly recovery
// screen instead of a white screen of death. Deliberately theme-independent
// (hardcoded neutral colors): if theming itself is what broke, this screen
// must still render.
export default class RootErrorBoundary extends Component {
  state = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn('Root render error:', error && error.message, info && info.componentStack);
  }

  // Bumping resetKey remounts the entire subtree — a fresh start without
  // killing the JS process.
  handleRestart = () => {
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container} accessibilityRole="alert">
          <Text style={styles.emoji}>🫠</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>An unexpected error crashed the screen.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.handleRestart}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Restart the app"
          >
            <Text style={styles.buttonText}>Tap to restart</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emoji: { fontSize: 48, marginBottom: 8 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#e5e7eb',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
