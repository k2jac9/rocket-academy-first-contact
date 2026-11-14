export interface ServerConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly mongodbUri: string;
  readonly mongodbDb: string;
}

/** Server-only environment. Never import this module from frontend code. */
export function readConfig(environment: Record<string, string | undefined> = process.env): ServerConfig {
  const portText = environment.FIRST_CONTACT_API_PORT?.trim() || '8787';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('FIRST_CONTACT_API_PORT must be an integer between 1024 and 65535.');
  }
  const geminiModel = environment.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(geminiModel))
    throw new Error('GEMINI_MODEL has an invalid model identifier.');
  const mongodbDb = environment.MONGODB_DB?.trim() || 'rocket_academy';
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(mongodbDb))
    throw new Error('MONGODB_DB must use letters, digits, underscores, or hyphens.');
  const configuredOrigins = environment.FIRST_CONTACT_ALLOWED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length
    ? configuredOrigins.map((value) => {
        try {
          const url = new URL(value);
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
          )
            throw new Error();
          return url.origin;
        } catch {
          throw new Error(
            'FIRST_CONTACT_ALLOWED_ORIGINS must be a comma-separated list of exact HTTP origins.',
          );
        }
      })
    : [
        `http://localhost:5173`,
        `http://127.0.0.1:5173`,
        `http://localhost:4173`,
        `http://127.0.0.1:4173`,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ];
  return {
    host: '127.0.0.1',
    port,
    allowedOrigins: [...new Set(allowedOrigins)],
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    geminiApiKey: environment.GEMINI_API_KEY?.trim() || '',
    geminiModel,
    mongodbUri: environment.MONGODB_URI?.trim() || '',
    mongodbDb,
  };
}
