export class GitLabApiError extends Error {
  public readonly retryAfter?: number;

  constructor(
    public readonly status: number,
    message: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = "GitLabApiError";
    this.retryAfter = retryAfter;
  }
}

interface ErrorInfo {
  status: number;
  message: string;
  retryAfter?: number;
}

export function handleApiError(err: unknown): ErrorInfo {
  if (err instanceof GitLabApiError) {
    return { status: err.status, message: err.message, retryAfter: err.retryAfter };
  }
  const status =
    err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
  const retryAfter =
    err && typeof err === "object" && "retryAfter" in err
      ? (err as { retryAfter: number }).retryAfter
      : undefined;
  const message =
    err instanceof Error ? err.message : "Failed to reach GitLab API";
  return { status, message, retryAfter };
}