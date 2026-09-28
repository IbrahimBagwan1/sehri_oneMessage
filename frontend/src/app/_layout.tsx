// @ts-nocheck
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useFonts, Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';
import useNotificationRouting from '../hooks/useNotificationRouting';
import AppErrorScreen from '../components/AppErrorScreen';
import { initMonitoring, wrapRoot } from '../services/monitoring';

// Crash reporting starts before the first render so a crash during startup
// is captured too. A no-op without a DSN and in development.
initMonitoring();

/**
 * expo-router renders this in place of any route that throws while
 * rendering — a recoverable screen instead of a blank one.
 */
export function ErrorBoundary(props) {
  return <AppErrorScreen {...props} />;
}

/**
 * Amiri is a classical Arabic Naskh typeface designed to be a modern
 * Uthmani-style face — the closest legally-redistributable equivalent
 * to a proper muṣḥaf typeface. Loaded here so Quran + Dua screens can
 * reference the family names directly without individual useFonts calls.
 */
function RootLayout() {

  // Tapping a notification has to land somewhere. Mounted at the root so it
  // survives navigation, and so a tap that cold-starts the app is caught
  // before any screen has rendered.
  useNotificationRouting();
  const [fontsLoaded, fontError] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
  });

  // Hold rendering until Arabic fonts are available. Without this, the
  // Quran reader would flash the OS Arabic font (usually Noto Naskh)
  // for a beat before swapping to Amiri. If the font fails to load, render
  // anyway with the system Arabic font — a blank screen forever (what a
  // load error used to mean) is far worse than a different typeface.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: '#F8FAFC' }} />;
  }

  return (
    // KeyboardProvider feeds every keyboard-aware view in the app a live
    // reading of the IME frame. It has to sit above the navigator so the
    // measurement survives navigation, and it is required by
    // components/ui/KeyboardAwareScroll.js — without it those views
    // silently stop avoiding the keyboard.
    <KeyboardProvider
      // Expo SDK 54+ turns edge-to-edge on permanently, so both system
      // bars are translucent and the window never resizes for the IME.
      // These three flags tell the library that, so it measures the real
      // keyboard inset instead of assuming an opaque-bar layout:
      //   statusBarTranslucent / navigationBarTranslucent — also what makes
      //     keyboard avoidance work inside a react-native <Modal>, which
      //     Android renders in its own window
      //   preserveEdgeToEdge — stops the library turning edge-to-edge off
      //     underneath Expo, which would break every safe-area inset
      statusBarTranslucent
      navigationBarTranslucent
      preserveEdgeToEdge
    >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(user)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="(rider)" />
        <Stack.Screen name="super-admin" />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="feedback" options={{ headerShown: false }} />
        <Stack.Screen name="quran-reader" options={{ headerShown: false }} />
        <Stack.Screen name="dua-detail" options={{ headerShown: false }} />
        <Stack.Screen name="donation-history" options={{ headerShown: false }} />
        <Stack.Screen name="chat-room" options={{ headerShown: false }} />
        <Stack.Screen name="chat-create-group" options={{ headerShown: false }} />
        <Stack.Screen name="chat-group-manage" options={{ headerShown: false }} />
        <Stack.Screen name="vote-history" options={{ headerShown: false }} />
        <Stack.Screen name="blocked-users" options={{ headerShown: false }} />
        <Stack.Screen name="credits" options={{ headerShown: false }} />
      </Stack>
      {/* Always dark icons: the app has one light theme (see
          userInterfaceStyle in app.config.js), so following the system's
          dark mode put white icons on a light background. */}
      <StatusBar style="dark" />
    </KeyboardProvider>
  );
}

export default wrapRoot(RootLayout);
