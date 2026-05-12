/**
 * src/lib/pharmacy.ts
 * Pharmacy inventory helpers — search, stock check, dispensing
 */
import { supabase } from './supabase'

export interface PharmacyMedicine {
  id: string
  name: string
  generic_name: string | null
  brand_name: string | null
  form: string
  strength: string | null
  category: string | null
  mrp: number | null
  selling_price: number | null
  current_stock: number
  min_stock: number
  unit: string
  is_active: boolean
}

/**
 * Search medicines by name/generic/brand — for prescription autocomplete.
 * Returns top 10 matches sorted by relevance.
 */
export async function searchMedicines(query: string): Promise<PharmacyMedicine[]> {
  if (!query || query.trim().length < 2) return []
  const q = query.trim()
  const { data } = await supabase
    .from('pharmacy_medicines')
    .select('id, name, generic_name, brand_name, form, strength, category, mrp, selling_price, current_stock, min_stock, unit, is_active')
    .eq('is_active', true)
    .or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,brand_name.ilike.%${q}%`)
    .order('name')
    .limit(10)
  return (data || []) as PharmacyMedicine[]
}

/**
 * Check if medicine has sufficient stock.
 */
export function hasStock(medicine: PharmacyMedicine, requiredQty: number = 1): boolean {
  return medicine.current_stock >= requiredQty
}

/**
 * Check if medicine is below minimum stock level.
 */
export function isLowStock(medicine: PharmacyMedicine): boolean {
  return medicine.current_stock <= medicine.min_stock
}

/**
 * Dispense medicine — reduces stock and logs the transaction.
 * Call this when a prescription is dispensed at the pharmacy counter.
 */
export async function dispenseMedicine(params: {
  medicineId: string
  quantity: number
  patientName?: string
  prescriptionId?: string
  doneBy?: string
}): Promise<{ success: boolean; error?: string }> {
  const { data: med } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock, name')
    .eq('id', params.medicineId)
    .single()

  if (!med) return { success: false, error: 'Medicine not found' }
  if (med.current_stock < params.quantity) {
    return { success: false, error: `Insufficient stock for ${med.name}. Available: ${med.current_stock}` }
  }

  const { error: updateErr } = await supabase
    .from('pharmacy_medicines')
    .update({
      current_stock: med.current_stock - params.quantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.medicineId)

  if (updateErr) return { success: false, error: updateErr.message }

  await supabase.from('pharmacy_stock_log').insert({
    medicine_id: params.medicineId,
    type: 'dispense',
    quantity: -params.quantity,
    reference_id: params.prescriptionId || null,
    notes: params.patientName ? `Dispensed to ${params.patientName}` : 'Dispensed',
    done_by: params.doneBy || null,
  })

  return { success: true }
}

/**
 * Add stock (purchase) — increases stock and logs.
 */
export async function addStock(params: {
  medicineId: string
  quantity: number
  batchNumber?: string
  expiryDate?: string
  purchasePrice?: number
  supplier?: string
  doneBy?: string
}): Promise<{ success: boolean; error?: string }> {
  const { data: med } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock')
    .eq('id', params.medicineId)
    .single()

  if (!med) return { success: false, error: 'Medicine not found' }

  const { error: updateErr } = await supabase
    .from('pharmacy_medicines')
    .update({
      current_stock: med.current_stock + params.quantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.medicineId)

  if (updateErr) return { success: false, error: updateErr.message }

  let batchId: string | null = null
  if (params.batchNumber && params.expiryDate) {
    const { data: batch } = await supabase.from('pharmacy_batches').insert({
      medicine_id: params.medicineId,
      batch_number: params.batchNumber,
      expiry_date: params.expiryDate,
      quantity: params.quantity,
      purchase_price: params.purchasePrice || null,
      supplier: params.supplier || null,
    }).select('id').single()
    batchId = batch?.id || null
  }

  await supabase.from('pharmacy_stock_log').insert({
    medicine_id: params.medicineId,
    batch_id: batchId,
    type: 'purchase',
    quantity: params.quantity,
    notes: params.supplier ? `Purchased from ${params.supplier}` : 'Stock added',
    done_by: params.doneBy || null,
  })

  return { success: true }
}

/**
 * Get medicines expiring within N days.
 */
export async function getExpiringMedicines(withinDays: number = 30): Promise<any[]> {
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + withinDays)
  const { data } = await supabase
    .from('pharmacy_batches')
    .select('*, pharmacy_medicines(name, brand_name, strength)')
    .lte('expiry_date', futureDate.toISOString().split('T')[0])
    .gt('quantity', 0)
    .order('expiry_date')
  return data || []
}

/**
 * Get all medicines below their minimum stock threshold.
 */
export async function getLowStockMedicines(): Promise<PharmacyMedicine[]> {
  const { data } = await supabase
    .from('pharmacy_medicines')
    .select('*')
    .eq('is_active', true)
    .order('current_stock')
  if (!data) return []
  return (data as PharmacyMedicine[]).filter(m => m.current_stock <= m.min_stock)
}
