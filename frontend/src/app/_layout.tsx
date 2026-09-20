// @ts-nocheck
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useColorScheme, View } from 'react-native';
import { useFonts, Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';

/**
 * Amiri is a classical Arabic Naskh typeface designed to be a modern
 * Uthmani-style face — the closest legally-redistributable equivalent
 * to a proper muṣḥaf typeface. Loaded here so Quran + Dua screens can
 * reference the family names directly without individual useFonts calls.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
  });

  // Hold rendering until Arabic fonts are available. Without this, the
  // Quran reader would flash the OS Arabic font (usually Noto Naskh)
  // for a beat before swapping to Amiri.
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F8FAFC' }} />;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(user)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="(rider)" />
        <Stack.Screen name="super-admin" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="feedback" options={{ headerShown: false }} />
        <Stack.Screen name="quran-reader" options={{ headerShown: false }} />
        <Stack.Screen name="dua-detail" options={{ headerShown: false }} />
        <Stack.Screen name="donation-history" options={{ headerShown: false }} />
        <Stack.Screen name="chat-room" options={{ headerShown: false }} />
        <Stack.Screen name="chat-create-group" options={{ headerShown: false }} />
        <Stack.Screen name="vote-history" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}