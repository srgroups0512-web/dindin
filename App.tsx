import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import DinDinApp from './src/DinDinApp';

export default function App() {
  return (
    <SafeAreaProvider>
      <DinDinApp />
    </SafeAreaProvider>
  );
}
