import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../logger'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, path: req.path, message: err.message }, 'Application error')
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    })
    return
  }

  if (err instanceof ZodError) {
    logger.warn({ path: req.path, errors: err.errors }, 'Validation error')
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors
      }
    })
    return
  }

  logger.error({ err, path: req.path }, 'Unhandled error')

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message
    }
  })
}

export function sendError(res: Response, error: any, logLabel?: string) {
  if (error instanceof AppError) {
    if (logLabel) logger.warn({ code: error.code, message: error.message }, logLabel)
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details }
    })
  }
  if (logLabel) logger.error(error, logLabel)
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : error.message || 'An unexpected error occurred'
    }
  })
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    }
  })
}
