import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthSheet } from '@/components/auth-sheet';
import { AuthProvider } from '@/lib/auth';
import { COLORS } from '@/lib/config';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { RouteProvider } from '@/lib/route';
import { TripProvider } from '@/lib/trip';

export const unstable_settings = {
  anchor: '(tabs)',
};

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: COLORS.brand },
};

export default function RootLayout() {
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
