import React, { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, Fonts } from '../../config/theme';
import Icon from '../ui/Icon';
import GradientButton from '../ui/GradientButton';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.icon}><Icon name="exclamationmark.triangle" size={40} color={Colors.warning} /></View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          {this.state.error?.message ?? 'An unexpected error occurred'}
        </Text>
        <GradientButton label="Try Again" onPress={this.handleReset} style={styles.button} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  icon: { marginBottom: Spacing.md },
  title: {
    fontFamily: Fonts.rounded,
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  message: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  button: { alignSelf: 'stretch' },
});
