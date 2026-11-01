import { RedHatDisplay_300Light } from '@expo-google-fonts/red-hat-display/300Light';
import { RedHatDisplay_400Regular } from '@expo-google-fonts/red-hat-display/400Regular';
import { RedHatDisplay_500Medium } from '@expo-google-fonts/red-hat-display/500Medium';
import { RedHatDisplay_700Bold } from '@expo-google-fonts/red-hat-display/700Bold';
import { RedHatDisplay_800ExtraBold } from '@expo-google-fonts/red-hat-display/800ExtraBold';
import { RedHatDisplay_900Black } from '@expo-google-fonts/red-hat-display/900Black';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { AuthSheet } from '@/components/auth-sheet';
import { AuthProvider } from '@/lib/auth';
import { BRAND, COLORS } from '@/lib/config';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { RouteProvider } from '@/lib/route';
import { TripProvider } from '@/lib/trip';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: COLORS.brand, background: BRAND.cream, text: BRAND.navy },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    RedHatDisplay_300Light, RedHatDisplay_400Regular, RedHatDisplay_500Medium, RedHatDisplay_700Bold,
    RedHatDisplay_800ExtraBold, RedHatDisplay_900Black,
  });
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <ThemeProvider value={theme}>
      <PrefsProvider>
        <AuthProvider>
          <DataProvider>
            <RouteProvider>
              <TripProvider>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="navigate"
                    options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
                  />
                  <Stack.Screen name="tour" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
                </Stack>
                <AuthSheet />
                <StatusBar style="dark" />
              </TripProvider>
            </RouteProvider>
          </DataProvider>
        </AuthProvider>
      </PrefsProvider>
    </ThemeProvider>
  );
}
