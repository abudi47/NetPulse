import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';

async function renderApp() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  return renderer;
}

/** Every string drawn on screen, in order. */
function visibleText(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  const collected: string[] = [];
  const visit = (node: ReactTestRenderer.ReactTestRendererNode | null) => {
    if (node === null) {
      return;
    }
    if (typeof node === 'string') {
      collected.push(node);
      return;
    }
    node.children?.forEach(visit);
  };
  const tree = renderer.toJSON();
  (Array.isArray(tree) ? tree : [tree]).forEach(visit);
  return collected;
}

// Jest has no native modules, so the app runs here exactly as it would on a
// build without the NetPulse module: everything must read as unavailable.
describe('App', () => {
  it('launches to the NetPulse dashboard', async () => {
    const text = visibleText(await renderApp());

    expect(text).toContain('NetPulse');
    expect(text).toContain('Monitoring is off');
    expect(text).toContain('Connection');
    expect(text).toContain('Recent activity');
    expect(text).toContain('No activity yet');
  });

  it('labels every reading as unavailable instead of showing a value', async () => {
    const text = visibleText(await renderApp());

    // Six connection rows plus the recovery and diagnostic-data tiles.
    expect(text.filter(line => line === 'Unavailable')).toHaveLength(8);
    expect(text).toContain('No live data');
  });

  it('shows no numbers, so no metric can have been invented', async () => {
    const text = visibleText(await renderApp());

    expect(text.filter(line => /\d/.test(line))).toEqual([]);
  });

  it('cannot start monitoring before a monitor exists', async () => {
    const renderer = await renderApp();
    const buttons = renderer.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button',
    );

    // The monitoring control is the only button, and it is disabled.
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.testID).toBe('monitoring-control');
    expect(buttons[0].props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
