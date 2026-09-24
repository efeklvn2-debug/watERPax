import { Request, Response, NextFunction } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { ParsedQs } from 'qs'
import { ZodSchema, ZodError } from 'zod'
import { createChildLogger } from '../logger'

const logger = createChildLogger('validation')

export function validateRequest<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ errors: error.errors, path: req.path }, 'Validation failed')
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}

export function validateParams<T extends ParamsDictionary>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ errors: error.errors, path: req.path }, 'Param validation failed')
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid URL parameters',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}

export function validateQuery<T extends ParsedQs>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ errors: error.errors, path: req.path }, 'Query validation failed')
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: error.errors
          }
        })
        return
      }
      next(error)
    }
  }
}
