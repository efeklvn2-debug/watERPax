export type MaterialCategory =
  | 'RAW_MATERIAL'
  | 'PACKAGING'
  | 'FINISHED_GOOD'
  | 'CONSUMABLE'

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | 'INITIAL' | 'RETURN'

export interface Material {
  id: string
  code: string
  name: string
  category: MaterialCategory
  subCategory?: string | null
  unitOfMeasure: string
  minStock: number
  costPrice?: number | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface MaterialWithStock extends Material {
  totalStock: number
  locations: { location: string; quantity: number }[]
}

export interface Stock {
  id: string
  materialId: string
  quantity: number
  location: string | null
  createdAt: Date
  updatedAt: Date
}

export interface StockMovement {
  id: string
  materialId: string
  stockId: string | null
  type: MovementType
  quantity: number
  reference: string | null
  notes: string | null
  createdAt: Date
  createdById: string | null
}
