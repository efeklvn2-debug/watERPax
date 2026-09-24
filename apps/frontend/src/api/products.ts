import { api } from './client'

export type ProductCategory = 'BOTTLED' | 'SACHET' | 'JAR'

export interface Product {
  id: string
  code: string
  name: string
  category: ProductCategory
  isActive: boolean
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
  availableFgQty?: number
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

export const productsApi = {
  list: async (includeInactive = false) => {
    return api.get<ProductWithVariants[]>(`/products${includeInactive ? '?includeInactive=true' : ''}`)
  },
  get: async (id: string) => {
    return api.get<ProductWithVariants>(`/products/${id}`)
  },
  create: async (data: { code: string; name: string; category: ProductCategory }) => {
    return api.post<Product>('/products', data)
  },
  update: async (id: string, data: { name?: string; isActive?: boolean }) => {
    return api.patch<Product>(`/products/${id}`, data)
  },
  createVariant: async (productId: string, data: { label: string; packSize: number; unitOfMeasure?: string; pricePerUnit: number; refillPrice?: number; jarMaterialId?: string | null }) => {
    return api.post<ProductVariant>(`/products/${productId}/variants`, data)
  },
  updateVariant: async (variantId: string, data: Partial<{ label: string; packSize: number; unitOfMeasure: string; pricePerUnit: number; refillPrice: number; jarMaterialId: string | null; isActive: boolean }>) => {
    return api.patch<ProductVariant>(`/products/variants/${variantId}`, data)
  },
  getBom: async (variantId: string) => {
    return api.get<BOMLine[]>(`/products/variants/${variantId}/bom`)
  },
  replaceBom: async (variantId: string, lines: { materialId: string; qtyPerPack: number; grammage?: number; wastagePct?: number }[]) => {
    return api.put<BOMLine[]>(`/products/variants/${variantId}/bom`, { lines })
  }
}
