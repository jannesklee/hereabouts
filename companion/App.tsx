// Import the task definition before any React rendering so expo-task-manager
// can register 'hereabouts-background-location' at module load time.
import './src/locationTask';

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { inviteFromAppLink } from './src/appLink';
import { loadConfig, type AppConfig } from './src/config';
import SetupScreen from './src/SetupScreen';
import HomeScreen from './src/HomeScreen';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconfiguring, setReconfiguring] = useState(false);
  // Invite link the app was opened with (hereabouts://join?url=...), until
  // HomeScreen has dealt with it. SetupScreen only pre-fills it and leaves it
  // pending, so it's still handled after setup is done.
  const [incomingInvite, setIncomingInvite] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then((c) => {
      setConfig(c);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const take = (link: string | null) => {
      const invite = inviteFromAppLink(link);
      if (invite) setIncomingInvite(invite);
    };
    Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener('url', ({ url }) => take(url));
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#0082c9" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {config?.isValid && !reconfiguring ? (
        <HomeScreen
          config={config}
          onConfigChange={setConfig}
          onReconfigure={() => setReconfiguring(true)}
          incomingInvite={incomingInvite}
          onInviteHandled={() => setIncomingInvite(null)}
        />
      ) : (
        <SetupScreen
          incomingInvite={incomingInvite}
          initialConfig={config}
          onSaved={(c) => {
            setConfig(c);
            setReconfiguring(false);
          }}
          onCancel={config?.isValid ? () => setReconfiguring(false) : undefined}
        />
      )}
    </SafeAreaProvider>
  );
}
