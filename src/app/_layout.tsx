import { RedHatDisplay_300Light } from "@expo-google-fonts/red-hat-display/300Light";
import { RedHatDisplay_400Regular } from "@expo-google-fonts/red-hat-display/400Regular";
import { RedHatDisplay_500Medium } from "@expo-google-fonts/red-hat-display/500Medium";
import { RedHatDisplay_700Bold } from "@expo-google-fonts/red-hat-display/700Bold";
import { RedHatDisplay_800ExtraBold } from "@expo-google-fonts/red-hat-display/800ExtraBold";
import { RedHatDisplay_900Black } from "@expo-google-fonts/red-hat-display/900Black";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";

// Defines the background navigation location task at startup (must run at module scope).
import "@/lib/bg-location";
import { AuthSheet } from "@/components/auth-sheet";
import { LaunchDoneContext, LaunchScreen } from "@/components/launch-screen";
import { AuthProvider } from "@/lib/auth";
import { DataProvider } from "@/lib/data";
import { LanguageProvider } from "@/lib/i18n";
import { PrefsProvider } from "@/lib/prefs";
import { RideLogProvider } from "@/lib/ridelog";
import { RouteProvider } from "@/lib/route";
import { ThemeProvider as AppThemeProvider, useTheme } from "@/lib/theme";
import { TripProvider } from "@/lib/trip";

export const unstable_settings = {
  anchor: "(tabs)",
};

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <LanguageProvider>
        <AppShell />
      </LanguageProvider>
    </AppThemeProvider>
  );
}

function AppShell() {
  const { c } = useTheme();
  const base = c.dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.bg,
      card: c.surface,
      text: c.text,
      border: c.border,
    },
  };
  const [fontsLoaded, fontError] = useFonts({
    RedHatDisplay_300Light,
    RedHatDisplay_400Regular,
    RedHatDisplay_500Medium,
    RedHatDisplay_700Bold,
    RedHatDisplay_800ExtraBold,
    RedHatDisplay_900Black,
  });
  const ready = fontsLoaded || !!fontError;
  const [showLaunch, setShowLaunch] = useState(true);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <LaunchDoneContext.Provider value={!showLaunch}>
      <ThemeProvider value={theme}>
        <PrefsProvider>
          <AuthProvider>
            <DataProvider>
              <RouteProvider>
                <RideLogProvider>
                  <TripProvider>
                    <Stack>
                      <Stack.Screen
                        name="(tabs)"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="navigate"
                        options={{
                          headerShown: false,
                          presentation: "fullScreenModal",
                          gestureEnabled: false,
                          animation: "fade",
                        }}
                      />
                      <Stack.Screen
                        name="tour"
                        options={{
                          headerShown: false,
                          presentation: "fullScreenModal",
                          animation: "fade",
                        }}
                      />
                    </Stack>
                    {!showLaunch && <AuthSheet />}
                    <StatusBar
                      style={showLaunch || c.dark ? "light" : "dark"}
                    />
                    {showLaunch && (
                      <LaunchScreen onDone={() => setShowLaunch(false)} />
                    )}
                  </TripProvider>
                </RideLogProvider>
              </RouteProvider>
            </DataProvider>
          </AuthProvider>
        </PrefsProvider>
      </ThemeProvider>
    </LaunchDoneContext.Provider>
  );
}
