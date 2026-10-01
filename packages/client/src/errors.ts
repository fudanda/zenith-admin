export class ClientError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export class ApiError extends Error {
  constructor(readonly code: number, message: string) {
    super(message || `请求失败（code=${code}）`);
    this.name = 'ApiError';
  }
}
