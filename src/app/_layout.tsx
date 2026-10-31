import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { COLORS } from '@/lib/config';
import { DataProvider } from '@/lib/data';
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
      <DataProvider>
        <RouteProvider>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="dark" />
        </RouteProvider>
      </DataProvider>
    </ThemeProvider>
  );
}
