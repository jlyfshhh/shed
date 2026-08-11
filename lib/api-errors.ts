/**
 * Errors that are safe and useful to show to the person making the request.
 *
 * Backend exceptions must never use this type. D1/R2 errors can contain SQL,
 * table names, object keys, or provider diagnostics that do not belong in an
 * HTTP response.
 */
export class ApiInputError extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409 = 400) {
    super(message);
    this.name = "ApiInputError";
    this.status = status;
  }
}

type ErrorResponseOptions = {
  context: string;
  message: string;
  headers?: HeadersInit;
};

/** Log an unexpected backend failure and expose only a stable public message. */
export function internalErrorResponse(error: unknown, options: ErrorResponseOptions): Response {
  console.error(options.context, error);
  return errorJson(options.message, 500, options.headers);
}

/** Preserve explicitly classified request errors; contain everything else. */
export function safeErrorResponse(error: unknown, options: ErrorResponseOptions): Response {
  if (error instanceof ApiInputError) {
    return errorJson(error.message, error.status, options.headers);
  }
  return internalErrorResponse(error, options);
}

function errorJson(message: string, status: number, initialHeaders?: HeadersInit): Response {
  const headers = new Headers(initialHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json({ error: message }, { status, headers });
}
