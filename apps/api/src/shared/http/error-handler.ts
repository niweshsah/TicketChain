import { ContractValidationError } from '@ticketchain/shared';
import { type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { httpFailures, conflicts } from './metrics';

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const validationError =
    error instanceof ZodError || error instanceof ContractValidationError
      ? error
      : undefined;
  const parserStatus =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error.status === 400 || error.status === 413)
      ? error.status
      : undefined;
  const status =
    error instanceof AppError
      ? error.status
      : validationError
        ? 400
        : parserStatus || 500;
  httpFailures.inc({ class: `${Math.floor(status / 100)}xx` });
  if (error instanceof AppError && error.code === 'SOLD_OUT') conflicts.inc();
  if (status === 500)
    console.error(
      JSON.stringify({
        event: 'request_failure',
        requestId: res.locals.requestId,
        type: error instanceof Error ? error.name : 'unknown',
      }),
    );
  res.status(status).json({
    code:
      error instanceof AppError
        ? error.code
        : validationError
          ? 'VALIDATION_ERROR'
          : parserStatus
            ? 'INVALID_BODY'
            : 'INTERNAL_ERROR',
    message:
      error instanceof AppError
        ? error.message
        : validationError
          ? 'Check the submitted fields'
          : parserStatus
            ? 'Request body is invalid or too large'
            : 'Unexpected error',
    requestId: res.locals.requestId,
    ...(validationError
      ? { fields: validationError.flatten().fieldErrors }
      : {}),
  });
}
