export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireValue<T>(
  value: T | null | undefined,
  code = 'NOT_FOUND',
): T {
  if (value == null) throw new AppError(404, code, 'Record not found');
  return value;
}

export function assertRule(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
