import { Router } from 'express'
import { healthController } from './controller'

export const healthRouter = Router()

healthRouter.get('/', healthController.check)
