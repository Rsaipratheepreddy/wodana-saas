import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { Button, Text } from '../design-system';
import { recordDeviceDiagnostic } from './diagnostics';

export class OperationalErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    void recordDeviceDiagnostic({ code: 'render_crash' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16 }}>
        <Text accessibilityRole="header" size="xl" weight="semibold">Wodana needs to reopen this screen</Text>
        <Text tone="textSecondary">Your saved offline work is kept on this device. Reopen the app if this screen fails again.</Text>
        <Button label="Try this screen again" onPress={() => this.setState({ failed: false })} />
      </View>
    );
  }
}
