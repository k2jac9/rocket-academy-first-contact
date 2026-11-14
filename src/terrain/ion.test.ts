import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveIonAsset } from './ion';

const endpoint = {
  url: 'https://terrain.example.test/root.json?v=3',
  accessToken: 'asset-scoped-test-token',
  type: '3DTILES',
  attributions: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('ion terrain authentication', () => {
  it('makes the initial endpoint request abortable and confines bearer credentials to the issued HTTPS origin', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(endpoint))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new AbortController();
    const asset = await resolveIonAsset(2684829, 'public-browser-test-token', lifecycle.signal);

    const endpointRequest = fetchMock.mock.calls[0];
    expect(endpointRequest[1]?.signal).toBe(lifecycle.signal);
    expect(new URL(String(endpointRequest[0])).searchParams.get('access_token')).toBe('public-browser-test-token');
    expect(asset.fetchPlugin.preprocessURL('https://terrain.example.test/child.glb')).toBe('https://terrain.example.test/child.glb?v=3');
    expect(asset.fetchPlugin.preprocessURL('https://other.example.test/child.glb')).toBe('https://other.example.test/child.glb');

    await asset.fetchPlugin.fetchData('https://terrain.example.test/child.glb');
    const tileOptions = fetchMock.mock.calls[1][1];
    expect(new Headers(tileOptions?.headers).get('Authorization')).toBe('Bearer asset-scoped-test-token');
    expect(tileOptions?.signal).toBe(lifecycle.signal);

    await asset.fetchPlugin.fetchData('https://other.example.test/child.glb');
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).has('Authorization')).toBe(false);
    expect(JSON.stringify(asset)).not.toContain('test-token');
  });

  it('combines scene cancellation with a tile-specific cancellation signal', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(endpoint))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const lifecycle = new AbortController();
    const tile = new AbortController();
    const asset = await resolveIonAsset(2684829, 'public-browser-test-token', lifecycle.signal);
    await asset.fetchPlugin.fetchData('https://terrain.example.test/child.glb', { signal: tile.signal });
    const combinedSignal = fetchMock.mock.calls[1][1]?.signal;
    expect(combinedSignal?.aborted).toBe(false);
    lifecycle.abort();
    expect(combinedSignal?.aborted).toBe(true);
  });

  it.each([
    'http://terrain.example.test/child.glb',
    'https://terrain.example.test:8443/child.glb',
  ])('never sends credentials or refreshes on a different origin: %s', async (url) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(endpoint))
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const asset = await resolveIonAsset(2684829, 'public-browser-test-token', new AbortController().signal);

    expect(asset.fetchPlugin.preprocessURL(url)).toBe(url);
    const response = await asset.fetchPlugin.fetchData(url, {
      headers: { Authorization: 'Bearer asset-scoped-test-token', 'X-Request-Purpose': 'terrain' },
    });

    const sentHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(sentHeaders.has('Authorization')).toBe(false);
    expect(sentHeaders.get('X-Request-Purpose')).toBe('terrain');
    expect(response.status).toBe(401);
    // Initial endpoint lookup plus the tile request; no cross-origin refresh.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes an expired asset credential once before retrying the failed tile', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(endpoint))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ...endpoint, accessToken: 'refreshed-test-token' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const asset = await resolveIonAsset(2684829, 'public-browser-test-token', new AbortController().signal);
    const response = await asset.fetchPlugin.fetchData('https://terrain.example.test/child.glb');
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer refreshed-test-token');
  });

  it.each(['TERRAIN', 'CZML'])('rejects unsupported %s assets without assuming an Earth ellipsoid', async (type) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...endpoint, type })));
    await expect(resolveIonAsset(2684829, 'public-browser-test-token', new AbortController().signal))
      .rejects.toThrow('not supported planetary 3D Tiles');
  });
});
