import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { ThemeProvider, useTheme } from '../theme';

/**
 * Application root: providers plus the only screen that exists so far.
 * A navigation library is added when a second screen is.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStatusBar />
        <DashboardScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Status-bar icons must contrast with the app background behind them. */
function ThemedStatusBar() {
  const { scheme } = useTheme();
  return (
    <StatusBar
      barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
    />
  );
}
