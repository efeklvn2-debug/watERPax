import { Request, Response, NextFunction } from 'express'
import { checkDatabaseConnection } from '../../database'
import { logger } from '../../logger'
import { sendError } from '../../middleware/errorHandler'

export const healthController = {
  async check(req: Request, res: Response, next: NextFunction) {
    try {
      const dbConnected = await checkDatabaseConnection()
      res.status(dbConnected ? 200 : 503).json({ status: dbConnected ? 'healthy' : 'unhealthy' })
    } catch (error) {
      logger.error({ err: error }, 'Health check failed')
      res.status(503).json({ status: 'unhealthy' })
    }
  }
}
