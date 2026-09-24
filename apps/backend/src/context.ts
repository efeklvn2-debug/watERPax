import { AsyncLocalStorage } from 'async_hooks'

export interface TenantContext {
  tenantId: string
}

const storage = new AsyncLocalStorage<TenantContext>()

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId
}

export function runWithTenant(tenantId: string, fn: () => void | Promise<void>) {
  return storage.run({ tenantId }, fn)
}

export function getTenantStore(): TenantContext | undefined {
  return storage.getStore()
}
