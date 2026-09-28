import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

import { ErrorCode, getStatusCode } from "../utils/errorCodes";

/**
 * Application-level error class with HTTP status code and error code.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCodeOrCode: number | ErrorCode | string,
    message: string,
    codeOrDetails?: string | unknown
  ) {
    super(message);
    this.name = "AppError";

    if (typeof statusCodeOrCode === "number") {
      this.statusCode = statusCodeOrCode;
      this.code = typeof codeOrDetails === "string" ? codeOrDetails : "INTERNAL_ERROR";
      this.details = typeof codeOrDetails === "object" ? codeOrDetails : undefined;
    } else {
      this.code = statusCodeOrCode;
      this.statusCode = getStatusCode(statusCodeOrCode as ErrorCode);
      this.details = codeOrDetails;
    }
  }
}

/**
 * Express error handler middleware. Formats and logs all unhandled errors.
 * @param err - The caught error.
 * @param req - Express request object.
 * @param res - Express response object.
 * @param _next - Unused next function (required for Express error handler signature).
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const correlationId = (req as any).requestId ?? "unknown";
  const reqLogger = (req as any).logger ?? logger;

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";

  reqLogger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    code,
    correlationId,
    method: req.method,
    path: req.path,
  });

  const responseBody: Record<string, unknown> = {
    error: err.message,
    code,
    correlationId,
  };

  if (err instanceof AppError && err.details !== undefined) {
    responseBody.details = err.details;
  }

  if (process.env.NODE_ENV === "development" && err.stack) {
    responseBody.stack = err.stack;
  }

  res.status(statusCode).json(responseBody);
}
