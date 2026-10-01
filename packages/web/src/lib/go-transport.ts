import { Client, type Method, type RequestOptions, type ApiEnvelope } from '@zenith/client';
export { ClientError as GoTransportError, validateGoPath } from '@zenith/client';
export type { ApiEnvelope as GoResponse } from '@zenith/client';

export const GO_SESSION_INVALIDATED = 'zenith:go-session-invalidated';

/** The Web host owns session notifications; transport lives in client. */
export class GoTransport extends Client {
  private binding?: { client: Client; abort: AbortController };

  constructor(send?: typeof fetch) {
    super({ transport: send, onUnauthorized: () => globalThis.dispatchEvent(new Event(GO_SESSION_INVALIDATED)) });
  }

  /** Original imperative page requests share the mounted host's client. */
  bind(client: Client): () => void {
    if (this.binding) throw new Error('Only one ZenithAdmin can be mounted in a document');
    if (client === this) throw new Error('ZenithAdmin needs a separate Client instance');
    const binding = { client, abort: new AbortController() };
    this.binding = binding;
    const unsubscribe = client.subscribeUnauthorized(() => globalThis.dispatchEvent(new Event(GO_SESSION_INVALIDATED)));
    return () => {
      if (this.binding !== binding) return;
      binding.abort.abort();
      unsubscribe();
      this.binding = undefined;
    };
  }

  private scoped<T extends { signal?: AbortSignal | null }>(options: T): T {
    if (!this.binding) return options;
    const signal = options.signal ? AbortSignal.any([options.signal, this.binding.abort.signal]) : this.binding.abort.signal;
    return { ...options, signal };
  }

  override setCsrfToken(value: string | null): void { if (this.binding) this.binding.client.setCsrfToken(value); else super.setCsrfToken(value); }
  override clearSession(): void { if (this.binding) this.binding.client.clearSession(); else super.clearSession(); }
  override sessionHeaders(): Record<string, string> { return this.binding ? this.binding.client.sessionHeaders() : super.sessionHeaders(); }
  override request<T>(method: Method, path: string, options: RequestOptions & { body?: unknown } = {}): Promise<ApiEnvelope<T>> {
    return this.binding ? this.binding.client.request<T>(method, path, this.scoped(options)) : super.request<T>(method, path, options);
  }
  override requestRaw<T>(path: string, options: RequestInit & RequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.binding ? this.binding.client.requestRaw<T>(path, this.scoped(options)) : super.requestRaw<T>(path, options);
  }
  override fetchRaw(path: string, options: RequestInit & RequestOptions = {}): Promise<Response> {
    return this.binding ? this.binding.client.fetchRaw(path, this.scoped(options)) : super.fetchRaw(path, options);
  }
  override readBlob(path: string, options: RequestInit & RequestOptions = {}): Promise<Blob> {
    return this.binding ? this.binding.client.readBlob(path, this.scoped(options)) : super.readBlob(path, options);
  }
  override postForm<T>(path: string, body: FormData, options: RequestOptions & { onProgress?: (percent: number) => void } = {}): Promise<ApiEnvelope<T>> {
    return this.binding ? this.binding.client.postForm<T>(path, body, this.scoped(options)) : super.postForm<T>(path, body, options);
  }
}

export const goTransport = new GoTransport();
