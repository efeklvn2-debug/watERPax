import { api } from './client'

export type RunStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface RunUsage {
  id: string
  materialId: string
  plannedQty: number
  actualQty: number
  wasteQty: number
  material?: { id: string; code: string; name: string; unitOfMeasure: string; category: string }
}

export interface ProductionRun {
  id: string
  runNumber: string
  variantId: string
  batchNumber: string
  status: RunStatus
  plannedPacks: number
  actualPacks: number | null
  notes: string | null
  totalMaterialCost: number | null
  totalPackagingCost: number | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  variant?: { id: string; label: string; packSize: number; product?: { name: string; category: string } }
  usages?: RunUsage[]
}

export const productionRunsApi = {
  list: async (status?: string) => {
    return api.get<ProductionRun[]>(`/production-runs${status ? `?status=${status}` : ''}`)
  },
  get: async (id: string) => {
    return api.get<ProductionRun>(`/production-runs/${id}`)
  },
  create: async (data: { variantId: string; plannedPacks: number; batchNumber?: string; notes?: string }) => {
    return api.post<ProductionRun>('/production-runs', data)
  },
  start: async (id: string) => {
    return api.post<ProductionRun>(`/production-runs/${id}/start`, {})
  },
  complete: async (id: string, data: { actualPacks: number; date?: string; notes?: string; usages?: { materialId: string; actualQty: number; wasteQty?: number }[] }) => {
    return api.post<{ alreadyCompleted: boolean; journalEntryId?: string; run: ProductionRun }>(`/production-runs/${id}/complete`, data)
  },
  cancel: async (id: string, reason?: string) => {
    return api.post<ProductionRun>(`/production-runs/${id}/cancel`, { reason })
  }
}
