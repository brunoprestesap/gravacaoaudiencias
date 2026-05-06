export class MaritacaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaritacaConfigError";
  }
}

export class MaritacaApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MaritacaApiError";
    this.status = status;
  }
}
