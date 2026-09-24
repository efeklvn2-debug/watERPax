import 'dotenv/config'
import { createApp } from './app'
import { logger } from './logger'
import { prisma } from './database'

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development'
}

const PORT = process.env.PORT || 3000

const app = createApp()

// Initial data seeding is handled by prisma/seed.ts — run `npx prisma db seed` after deploy.
// The inline seedInitialData() was removed to avoid hash drift between seed.ts and server startup.

async function start() {
  const maxRetries = 5
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect()
      logger.info('Database connected')
      break
    } catch (error: any) {
      logger.warn({ err: error, attempt, maxRetries }, `Database connection attempt ${attempt}/${maxRetries} failed, retrying...`)
      if (attempt === maxRetries) {
        logger.error({ err: error }, 'Failed to connect to database after all retries')
        process.exit(1)
      }
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt))
    }
  }

  try {
    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Server started')
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

start()

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully')
  await (prisma as any).$disconnect()
  process.exit(0)
})
