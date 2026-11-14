type IonEndpoint = {
  url: string;
  accessToken: string;
  type: '3DTILES';
  attributions: { html: string }[];
};

/**
 * Resolve ion explicitly so the first authentication request is abortable too.
 * All credentials remain in this scene's closure, and bearer credentials are sent
 * only to the exact HTTPS origin for which ion issued them. No endpoint response
 * is exported.
 */
export async function resolveIonAsset(assetId: number, browserToken: string, lifecycleSignal: AbortSignal) {
  const endpointUrl = new URL(`https://api.cesium.com/v1/assets/${assetId}/endpoint`);
  endpointUrl.searchParams.set('access_token', browserToken);

  async function getEndpoint(): Promise<IonEndpoint> {
    const response = await fetch(endpointUrl, { signal: lifecycleSignal, mode: 'cors' });
    if (!response.ok) {
      // Do not put request URLs or credentials in error messages or logs.
      throw new Error(`ion endpoint returned HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid ion endpoint response');
    const value = data as Record<string, unknown>;
    if (
      typeof value.url !== 'string' ||
      typeof value.accessToken !== 'string' ||
      value.type !== '3DTILES' ||
      new URL(value.url).protocol !== 'https:'
    ) {
      throw new Error('The selected ion asset is not supported planetary 3D Tiles');
    }
    return {
      url: value.url,
      accessToken: value.accessToken,
      type: value.type,
      attributions: Array.isArray(value.attributions)
        ? value.attributions.filter(
            (credit): credit is { html: string } =>
              Boolean(credit) && typeof credit === 'object' && typeof credit.html === 'string',
          )
        : [],
    };
  }

  let endpoint = await getEndpoint();
  let refresh: Promise<IonEndpoint> | null = null;
  const contentVersion = new URL(endpoint.url).searchParams.get('v');

  const fetchPlugin = {
    name: 'ABORTABLE_ION_FETCH',
    preprocessURL(url: string) {
      const target = new URL(url);
      if (
        contentVersion !== null &&
        target.protocol === 'https:' &&
        target.origin === new URL(endpoint.url).origin
      ) {
        target.searchParams.set('v', contentVersion);
      }
      return target.toString();
    },
    async fetchData(url: string, options: RequestInit = {}) {
      const requestUrl = new URL(url);
      const isIssuedOrigin = () =>
        requestUrl.protocol === 'https:' && requestUrl.origin === new URL(endpoint.url).origin;
      const signal = options.signal ? AbortSignal.any([options.signal, lifecycleSignal]) : lifecycleSignal;

      const request = () => {
        const headers = new Headers(options.headers);
        // Do not let a caller-supplied bearer bypass the same-origin boundary.
        headers.delete('Authorization');
        if (isIssuedOrigin()) {
          headers.set('Authorization', `Bearer ${endpoint.accessToken}`);
        }
        return fetch(url, { ...options, signal, headers });
      };

      let response = await request();
      if ((response.status === 401 || response.status === 403) && isIssuedOrigin() && !signal.aborted) {
        // Concurrent tile failures share one refresh, then get one retry each.
        refresh ??= getEndpoint().finally(() => {
          refresh = null;
        });
        endpoint = await refresh;
        response = await request();
      }
      return response;
    },
  };

  // Render provider credits as text, never as trusted HTML from a remote source.
  const credits = endpoint.attributions
    .map(({ html }) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim())
    .filter((credit): credit is string => Boolean(credit));

  return { url: endpoint.url, type: endpoint.type, credits, fetchPlugin };
}
