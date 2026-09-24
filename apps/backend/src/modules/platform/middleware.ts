import { Router, Response, NextFunction } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth'
import { AppError } from '../../middleware/errorHandler'

export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'))
  }
  if (req.user.role !== 'SUPER_ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Super admin access required'))
  }
  next()
}
