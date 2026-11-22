import ReactTestRenderer, { act } from 'react-test-renderer';
import { MonitoringStatusCard } from '../components/MonitoringStatusCard';
import type { MonitoringStatus } from '../dashboardViewModel';

async function render(
  partial: Pick<MonitoringStatus, 'state' | 'control'> &
    Partial<MonitoringStatus>,
) {
  const status: MonitoringStatus = {
    detail: null,
    notes: [],
    userAction: null,
    ...partial,
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(() => {
    renderer = ReactTestRenderer.create(
      <MonitoringStatusCard status={status} />,
    );
  });
  return {
    buttons: renderer.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button',
    ),
    text: JSON.stringify(renderer.toJSON()),
    // The native view behind the button: what a screen reader is told, and
    // where a tap arrives.
    button: renderer.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.testID === 'monitoring-control',
    ),
  };
}

function press(button: ReactTestRenderer.ReactTestInstance) {
  act(() => {
    button.props.onClick({ nativeEvent: {} });
  });
}

describe('MonitoringStatusCard', () => {
  it('shows the specific situation instead of the generic description', async () => {
    const { text } = await render({
      state: 'incident',
      control: { kind: 'available', onPress: jest.fn() },
      detail: 'Health checks timed out. Unreachable since 10:42:07.',
    });

    expect(text).toContain('Internet unreachable');
    expect(text).toContain(
      'Health checks timed out. Unreachable since 10:42:07.',
    );
    expect(text).not.toContain(
      'Repeated health checks failed on this network.',
    );
  });

  it('offers the user action only when there is one', async () => {
    const onPress = jest.fn();
    const withAction = await render({
      state: 'needs_user_action',
      control: { kind: 'available', onPress: jest.fn() },
      userAction: { label: 'Open network settings', onPress },
    });
    const without = await render({
      state: 'incident',
      control: { kind: 'available', onPress: jest.fn() },
    });

    expect(without.buttons).toHaveLength(1);
    expect(without.text).not.toContain('Open network settings');
    expect(withAction.buttons).toHaveLength(2);
    expect(withAction.text).toContain('Open network settings');

    press(withAction.buttons[1]);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lists every note it is given', async () => {
    const { text } = await render({
      state: 'healthy',
      control: { kind: 'available', onPress: jest.fn() },
      notes: [
        'Checks run only while NetPulse is open.',
        'Health checks are paused.',
      ],
    });

    expect(text).toContain('Recent health checks reached the internet.');
    expect(text).toContain('Checks run only while NetPulse is open.');
    expect(text).toContain('Health checks are paused.');
  });

  it('disables the control and explains why when monitoring cannot start', async () => {
    const reason = 'Monitoring is not available in this build yet.';
    const { text, button } = await render({
      state: 'idle',
      control: { kind: 'unavailable', reason },
    });

    expect(text).toContain('Monitoring is off');
    expect(text).toContain('Start monitoring');
    expect(text).toContain(reason);
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(button.props.accessibilityHint).toBe(reason);
    expect(() => press(button)).not.toThrow();
  });

  it('starts monitoring through the supplied handler when available', async () => {
    const onPress = jest.fn();
    const { text, button } = await render({
      state: 'idle',
      control: { kind: 'available', onPress },
    });

    expect(text).toContain('Start monitoring');
    expect(button.props.accessibilityState).toMatchObject({ disabled: false });
    press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('offers Stop while monitoring is running', async () => {
    const { text } = await render({
      state: 'healthy',
      control: { kind: 'available', onPress: jest.fn() },
    });

    expect(text).toContain('Connection healthy');
    expect(text).toContain('Stop monitoring');
    expect(text).not.toContain('Start monitoring');
  });
});
