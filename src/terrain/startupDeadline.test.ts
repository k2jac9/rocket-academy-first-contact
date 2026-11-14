import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartupDeadline } from './startupDeadline';
import type { TerrainStatus } from './types';

afterEach(() => vi.useRealTimers());

describe('terrain startup deadline', () => {
  it('keeps a retryable timeout visible when root metadata arrives late and content stalls', () => {
    vi.useFakeTimers();
    const displayed: TerrainStatus['state'][] = [];
    const deadline = createStartupDeadline(() => displayed.push('error'));
    const report = (state: TerrainStatus['state']) => {
      if (deadline.allows(state)) displayed.push(state);
    };
    report('loading');
    vi.advanceTimersByTime(30_000);
    expect(displayed.at(-1)).toBe('error');

    // Root metadata arrives at second 31, but the first content request stalls.
    vi.advanceTimersByTime(1000);
    report('loading');
    vi.advanceTimersByTime(120_000);
    report('loading');
    expect(displayed).toEqual(['loading', 'error']);

    // Only a real rendered tile's ready event may dismiss the startup error.
    report('ready');
    expect(displayed.at(-1)).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fire after scene disposal', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const deadline = createStartupDeadline(onTimeout);
    deadline.cancel();
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
