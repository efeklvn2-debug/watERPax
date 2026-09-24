export type ProductCategory = 'BOTTLED' | 'SACHET' | 'JAR'

export interface Product {
  id: string
  code: string
  name: string
  category: ProductCategory
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ProductVariant {
  id: string
  productId: string
  label: string
  packSize: number
  unitOfMeasure: string
  pricePerUnit: number
  refillPrice: number | null
  jarMaterialId: string | null
  isActive: boolean
}

export interface BOMLine {
  id: string
  variantId: string
  componentMaterialId: string
  qtyPerPack: number
  grammage: number | null
  wastagePct: number
  material?: {
    id: string
    code: string
    name: string
    category: string
    unitOfMeasure: string
    costPrice: number | null
  }
}

export interface ProductWithVariants extends Product {
  variants: (ProductVariant & { boms: BOMLine[] })[]
}
