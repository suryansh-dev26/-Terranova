import { ActivityIndicator, LogBox, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from './screens/HomeScreen';
import HistoryScreen from './HistoryScreen';
import LeaderboardScreen from './LeaderboardScreen';
import ProfileScreen from './ProfileScreen';
import SignInScreen from './screens/SignInScreen';
import DisplayNameScreen from './screens/DisplayNameScreen';
import FloatingTabBar from './components/FloatingTabBar';
import RootErrorBoundary from './components/RootErrorBoundary';
import { NotificationProvider } from './NotificationContext';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

// Firestore's realtime transport logs noisy connection warnings on React
// Native (esp. Android), which trip the full-screen dev LogBox overlay even
// though Firestore recovers on its own. Hide just those from the dev overlay —
// this is cosmetic (dev-only) and never affects production builds.
LogBox.ignoreLogs([
  /@firebase\/firestore/,
  /WebChannelConnection/,
  /Could not reach Cloud Firestore/,
]);

const Tab = createBottomTabNavigator();

// Navigation gets a theme too, so screen transitions don't flash white in
// dark mode. Light mode keeps React Navigation's stock DefaultTheme —
// pixel-identical to the pre-theme app.
function AppNavigator() {
  const { theme } = useTheme();
  const navTheme = theme.mode === 'dark'
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.bg,
          card: theme.surface,
          primary: theme.primary,
        },
      }
    : DefaultTheme;

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <FloatingTabBar {...props} />}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// Routes between session-restore splash, sign-in, the pick-a-name step for
// first-time email users, and the app itself. Guests re-enter the sign-in
// screen via Profile → "Sign in or create account" (showSignIn).
function AuthGate() {
  const { theme } = useTheme();
  const { initializing, user, needsDisplayName, showSignIn } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }
  if (!user || showSignIn) return <SignInScreen />;
  if (needsDisplayName) return <DisplayNameScreen />;
  return <AppNavigator />;
}

// Thin shell: theming outermost, then the crash catch-all, then app chrome.
// All real logic lives in screens/, hooks/, components/, auth/, and firebase.js.
export default function App() {
  return (
    <ThemeProvider>
      <RootErrorBoundary>
        <NotificationProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </NotificationProvider>
      </RootErrorBoundary>
    </ThemeProvider>
  );
}
