type ProviderHttpError = {
  code?: string;
  status?: number;
  retryable?: boolean;
  message?: string;
};

export function providerHttpError(
  c: any,
  code: string,
  message: string,
  status: number,
  retryable = status >= 500,
  requestId = c.req.header('cf-ray') || crypto.randomUUID(),
) {
  return c.json({
    code,
    message,
    retryable,
    request_id: requestId,
  }, status);
}

export function providerTaggedHttpError(c: any, error: unknown, fallbackMessage: string) {
  const tagged = error as ProviderHttpError;
  const status = Number(tagged?.status || 503);
  return providerHttpError(
    c,
    tagged?.code || 'provider_ingress_failed',
    status >= 500 ? fallbackMessage : tagged?.message || fallbackMessage,
    status,
    tagged?.retryable === true || status >= 500,
  );
}

export function providerUnhandledHttpError(c: any, error: unknown) {
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  console.error(JSON.stringify({
    event: 'provider_webhook_request_failed',
    request_id: requestId,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  }));
  return providerHttpError(
    c,
    'provider_webhook_unavailable',
    'Provider webhook processing is temporarily unavailable',
    500,
    true,
    requestId,
  );
}
