import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { COLORS } from '@/lib/config';
import { DataProvider } from '@/lib/data';

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
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="dark" />
      </DataProvider>
    </ThemeProvider>
  );
}
