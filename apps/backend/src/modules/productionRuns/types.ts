export type RunStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface BomSnapshotLine {
  materialId: string
  code: string
  name: string
  unitOfMeasure: string
  category: string
  qtyPerPack: number
  grammage: number | null
  wastagePct: number
  costPrice: number
}

export interface RunUsage {
  id: string
  materialId: string
  plannedQty: number
  actualQty: number
  wasteQty: number
  material?: {
    id: string
    code: string
    name: string
    unitOfMeasure: string
    category: string
  }
}

export interface ProductionRun {
  id: string
  runNumber: string
  variantId: string
  batchNumber: string
  status: RunStatus
  plannedPacks: number
  actualPacks: number | null
  bomSnapshot: BomSnapshotLine[] | null
  notes: string | null
  totalMaterialCost: number | null
  totalPackagingCost: number | null
  startedAt: string | null
  completedAt: string | null
}

export interface CompleteRunResult {
  alreadyCompleted: boolean
  journalEntryId?: string
  run: unknown
}
