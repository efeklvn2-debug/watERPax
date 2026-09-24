import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import { authRouter } from './modules/auth'
import { healthRouter } from './modules/health'
import { inventoryRouter } from './modules/inventory'
import { procurementRouter } from './modules/procurement'
import { supplierRouter } from './modules/suppliers'
import { settingsRouter } from './modules/settings'
import { productsRouter } from './modules/products'
import { productionRunsRouter } from './modules/productionRuns'
import { pricingRouter } from './modules/pricing'
import { financeRouter } from './modules/finance'
import { salesRouter } from './modules/sales'
import { customersRouter } from './modules/customers'
import { reportsRouter } from './modules/reports'
import { auditRouter } from './modules/audit'
import { platformRouter } from './modules/platform'
import { guideAngelRouter } from './modules/guideAngel'
import { taxRouter } from './modules/tax'
import { honeypotMiddleware } from './middleware/honeypot'
import { idempotencyMiddleware } from './middleware/idempotency'
import { csrfProtection } from './middleware/csrf'
import { cspReportHandler } from './middleware/cspReport'
import { cspLimiter } from './middleware/rateLimiters'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { logger } from './logger'

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)

  app.use(honeypotMiddleware)

  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
  }))
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", process.env.CORS_ORIGIN || 'http://localhost:5173'].filter(Boolean),
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        scriptSrcAttr: ["'none'"],
        upgradeInsecureRequests: [],
        reportUri: ['/api/csp/report'],
      }
    },
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true
    }
  }))
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }
  })
  app.use('/api', limiter)

  app.use(idempotencyMiddleware)
  app.use(csrfProtection)

  app.post('/api/csp/report',
    cspLimiter,
    express.json({ type: ['application/json', 'application/csp-report', 'application/reports+json'], limit: '64kb' }),
    cspReportHandler)

  app.use('/api/health', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/inventory', inventoryRouter)
  app.use('/api/procurement', procurementRouter)
  app.use('/api/suppliers', supplierRouter)
  app.use('/api/products', productsRouter)
  app.use('/api/production-runs', productionRunsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/pricing', pricingRouter)
  app.use('/api/finance', financeRouter)
  app.use('/api/sales', salesRouter)
  app.use('/api/customers', customersRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/audit', auditRouter)
  app.use('/api/platform', platformRouter)
  app.use('/api/guide-angel', guideAngelRouter)
  app.use('/api/tax', taxRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  logger.info('Express app configured')

  return app
}
