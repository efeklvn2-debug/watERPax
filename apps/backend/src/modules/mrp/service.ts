import { prisma } from '../../database'
import { AppError } from '../../middleware/errorHandler'
import { inventoryService } from '../inventory/service'
import { settingsService } from '../settings/service'
import { createChildLogger } from '../../logger'
type SpecsJson = string | Record<string, unknown>

const logger = createChildLogger('mrp:service')

export const mrpService = {
  /**
   * Check material availability for a sales order based on its specs
   * @param specsJson The sales order specifications
   * @returns Object indicating availability and any missing materials
   */
  async checkAvailabilityForSpecs(specsJson: SpecsJson) {
    logger.info({ specsJson }, 'Checking material availability for specs')

    // Parse specs if string
    const specs = typeof specsJson === 'string' ? JSON.parse(specsJson) : specsJson

    const missingMaterials: Array<{
      materialId: string
      materialName: string
      required: number
      available: number
    }> = []

    // Check for main material
    if (specs.material) {
      // In a real system, we would look up the material by name/code to get its ID
      // For now, we'll treat specs.material as a material identifier (could be name, code, or id)
      // We'll try to find the material by name or code
      const material = await prisma.material.findFirst({
        where: {
          OR: [
            { name: specs.material },
            { code: specs.material }
          ]
        }
      })

      if (!material) {
        missingMaterials.push({
          materialId: specs.material, // placeholder
          materialName: specs.material,
          required: Number(specs.quantity) || 1,
          available: 0
        })
      } else {
        // Check stock for this material
        const materialsWithStock = await inventoryService.getMaterialsWithStock()
        const stockItem = materialsWithStock.find(m => m.id === material.id)
        const available = stockItem ? stockItem.totalStock : 0
        const required = Number(specs.quantity) || 1

        if (available < required) {
          missingMaterials.push({
            materialId: material.id,
            materialName: material.name,
            required,
            available
          })
        }
      }
    }

    // Check for core requirements
    if (specs.coresRequired) {
      // Find core material (we'll look for a material that is likely a core)
      const coreMaterial = await prisma.material.findFirst({
        where: {
          OR: [
            { name: { contains: 'core', mode: 'insensitive' } },
            { code: { contains: 'core', mode: 'insensitive' } }
          ]
        }
      })

      if (!coreMaterial) {
        missingMaterials.push({
          materialId: 'core-material-id', // placeholder
          materialName: 'Plastic Core',
          required: Number(specs.coresRequired),
          available: 0
        })
      } else {
        const materialsWithStock = await inventoryService.getMaterialsWithStock()
        const stockItem = materialsWithStock.find(m => m.id === coreMaterial.id)
        const available = stockItem ? stockItem.totalStock : 0
        const required = Number(specs.coresRequired)

        if (available < required) {
          missingMaterials.push({
            materialId: coreMaterial.id,
            materialName: coreMaterial.name,
            required,
            available
          })
        }
      }
    }

    // Check for any other material requirements in specs (if specs has other fields)
    // We'll ignore for now; can be extended

    const hasRequiredMaterials = missingMaterials.length === 0

    logger.info({ 
      hasRequiredMaterials, 
      missingMaterialsCount: missingMaterials.length 
    }, 'Material availability check completed')

    return {
      available: hasRequiredMaterials,
      missingMaterials,
      details: hasRequiredMaterials 
        ? { message: 'All materials available' } 
        : { message: `${missingMaterials.length} material(s) insufficient` }
    }
  },

  /**
   * Simple availability check for a specific material and quantity
   * @param materialId The material ID
   * @param quantity Required quantity
   * @returns Whether the material is available in sufficient quantity
   */
  async checkMaterialAvailability(materialId: string, quantity: number): Promise<{ available: boolean; availableQuantity: number }> {
    const materialsWithStock = await inventoryService.getMaterialsWithStock()
    const stockItem = materialsWithStock.find(m => m.id === materialId)
    const available = stockItem ? stockItem.totalStock : 0
    return {
      available: available >= quantity,
      availableQuantity: available
    }
  },

  /**
   * Reserve materials for a sales order (in a real system, this would create reservations)
   * For now, we just log that we would reserve; actual stock deduction happens at production
   * @param salesOrderId The sales order ID
   * @param specsJson The sales order specifications
   */
  async reserveMaterials(salesOrderId: string, specsJson: SpecsJson): Promise<void> {
    const availability = await this.checkAvailabilityForSpecs(specsJson)
    if (!availability.available) {
      throw new AppError(400, 'INSUFFICIENT_MATERIALS', 'Insufficient materials to reserve for sales order')
    }
    // In a real system, we would create reservation records here
    logger.info({ salesOrderId }, 'Materials reserved for sales order (logical only)')
  }
}