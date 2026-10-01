import { config } from './config';
import { AppError } from './errors';

export async function serviceRequest<T>(
  base: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': config.SERVICE_TOKEN,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'A required service is temporarily unavailable. Please retry.',
    );
  }
  const result = (await response.json()) as T & {
    code?: string;
    message?: string;
  };
  if (!response.ok)
    throw new AppError(
      response.status,
      result.code || 'SERVICE_FAILURE',
      result.message || 'Service request failed',
    );
  return result;
}
