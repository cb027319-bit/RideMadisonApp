import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthSheet } from '@/components/auth-sheet';
import { AuthProvider } from '@/lib/auth';
import { COLORS } from '@/lib/config';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { RouteProvider } from '@/lib/route';

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
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              </Stack>
              <AuthSheet />
              <StatusBar style="dark" />
            </RouteProvider>
          </DataProvider>
        </AuthProvider>
      </PrefsProvider>
    </ThemeProvider>
  );
}
