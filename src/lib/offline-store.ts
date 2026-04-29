/**
 * src/lib/offline-store.ts
 *
 * Offline-First Data Store using IndexedDB
 *
 * Provides:
 *   1. Patient data caching for offline search
 *   2. Vitals entry queue for offline submission
 *   3. Prescription draft storage
 *   4. Sync queue for background sync when online
 *   5. Clinic Mode: read-only access to cached data when Supabase is unreachable
 */

// ─── IndexedDB Setup ──────────────────────────────────────────

const DB_NAME = 'nexmedicon-offline'
const DB_VERSION = 1

const STORES = {
  patients: 'patients',
  encounters: 'encounters',
  prescriptions: 'prescriptions',
  syncQueue: 'sync-queue',
  metadata: 'metadata',
} as const

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Patients store — searchable by name, MRN, mobile
      if (!db.objectStoreNames.contains(STORES.patients)) {
        const patientStore = db.createObjectStore(STORES.patients, { keyPath: 'id' })
        patientStore.createIndex('full_name', 'full_name', { unique: false })
        patientStore.createIndex('mrn', 'mrn', { unique: true })
        patientStore.createIndex('mobile', 'mobile', { unique: false })
      }

      // Encounters store
      if (!db.objectStoreNames.contains(STORES.encounters)) {
        const encounterStore = db.createObjectStore(STORES.encounters, { keyPath: 'id' })
        encounterStore.createIndex('patient_id', 'patient_id', { unique: false })
        encounterStore.createIndex('encounter_date', 'encounter_date', { unique: false })
      }

      // Prescriptions store
      if (!db.objectStoreNames.contains(STORES.prescriptions)) {
        const rxStore = db.createObjectStore(STORES.prescriptions, { keyPath: 'id' })
        rxStore.createIndex('encounter_id', 'encounter_id', { unique: false })
      }

      // Sync queue — pending changes to upload
      if (!db.objectStoreNames.contains(STORES.syncQueue)) {
        const syncStore = db.createObjectStore(STORES.syncQueue, { keyPath: 'id', autoIncrement: true })
        syncStore.createIndex('timestamp', 'timestamp', { unique: false })
        syncStore.createIndex('type', 'type', { unique: false })
      }

      // Metadata store — last sync time, etc.
      if (!db.objectStoreNames.contains(STORES.metadata)) {
        db.createObjectStore(STORES.metadata, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ─── Generic CRUD Operations ──────────────────────────────────

async function putRecord(storeName: string, record: any): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(record)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function getRecord(storeName: string, key: string): Promise<any | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onsuccess = () => { db.close(); resolve(request.result || null) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

async function getAllRecords(storeName: string): Promise<any[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).getAll()
    request.onsuccess = () => { db.close(); resolve(request.result || []) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

async function deleteRecord(storeName: string, key: string | number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// ─── Patient Cache ────────────────────────────────────────────

/**
 * Cache patients for offline search.
 * Call this periodically or after patient list loads.
 */
export async function cachePatients(patients: any[]): Promise<void> {
  try {
    for (const patient of patients) {
      await putRecord(STORES.patients, {
        ...patient,
        _cachedAt: new Date().toISOString(),
      })
    }
    await putRecord(STORES.metadata, {
      key: 'lastPatientSync',
      value: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[Offline] Failed to cache patients:', err)
  }
}

/**
 * Search cached patients offline.
 */
export async function searchCachedPatients(query: string): Promise<any[]> {
  try {
    const all = await getAllRecords(STORES.patients)
    if (!query.trim()) return all.slice(0, 50)

    const q = query.toLowerCase()
    return all.filter(p =>
      p.full_name?.toLowerCase().includes(q) ||
      p.mrn?.toLowerCase().includes(q) ||
      p.mobile?.includes(q)
    ).slice(0, 50)
  } catch {
    return []
  }
}

/**
 * Get a single cached patient.
 */
export async function getCachedPatient(id: string): Promise<any | null> {
  try {
    return await getRecord(STORES.patients, id)
  } catch {
    return null
  }
}

// ─── Encounter Cache ──────────────────────────────────────────

export async function cacheEncounters(encounters: any[]): Promise<void> {
  try {
    for (const enc of encounters) {
      await putRecord(STORES.encounters, {
        ...enc,
        _cachedAt: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn('[Offline] Failed to cache encounters:', err)
  }
}

export async function getCachedEncounters(patientId: string): Promise<any[]> {
  try {
    const all = await getAllRecords(STORES.encounters)
    return all.filter(e => e.patient_id === patientId)
  } catch {
    return []
  }
}

// ─── Sync Queue ───────────────────────────────────────────────

export interface SyncQueueItem {
  id?: number
  type: 'create_encounter' | 'update_encounter' | 'create_prescription' | 'create_patient'
  table: string
  data: any
  timestamp: string
  retries: number
}

/**
 * Add an operation to the sync queue (for offline changes).
 */
export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retries'>): Promise<void> {
  try {
    await putRecord(STORES.syncQueue, {
      ...item,
      timestamp: new Date().toISOString(),
      retries: 0,
    })
  } catch (err) {
    console.warn('[Offline] Failed to add to sync queue:', err)
  }
}

/**
 * Get all pending sync items.
 */
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  try {
    return await getAllRecords(STORES.syncQueue)
  } catch {
    return []
  }
}

/**
 * Remove a synced item from the queue.
 */
export async function removeSyncItem(id: number): Promise<void> {
  try {
    await deleteRecord(STORES.syncQueue, id)
  } catch (err) {
    console.warn('[Offline] Failed to remove sync item:', err)
  }
}

// ─── Connection Status ────────────────────────────────────────

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
let _isSupabaseReachable = true
let _listeners: ((online: boolean) => void)[] = []

/**
 * Check if Supabase is reachable.
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url) return false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      },
    })

    clearTimeout(timeout)
    _isSupabaseReachable = res.ok
    return res.ok
  } catch {
    _isSupabaseReachable = false
    return false
  }
}

/**
 * Get current connection status.
 */
export function getConnectionStatus(): {
  browserOnline: boolean
  supabaseReachable: boolean
  isClinicMode: boolean
} {
  return {
    browserOnline: _isOnline,
    supabaseReachable: _isSupabaseReachable,
    isClinicMode: !_isSupabaseReachable,
  }
}

/**
 * Subscribe to connection status changes.
 */
export function onConnectionChange(callback: (online: boolean) => void): () => void {
  _listeners.push(callback)

  if (typeof window !== 'undefined') {
    const handleOnline = () => { _isOnline = true; callback(true) }
    const handleOffline = () => { _isOnline = false; callback(false) }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      _listeners = _listeners.filter(l => l !== callback)
    }
  }

  return () => { _listeners = _listeners.filter(l => l !== callback) }
}

// ─── Background Sync ──────────────────────────────────────────

/**
 * Process the sync queue — upload pending changes to Supabase.
 * Call this when connection is restored.
 */
export async function processSyncQueue(): Promise<{
  synced: number
  failed: number
}> {
  const { supabase } = await import('./supabase')
  const queue = await getSyncQueue()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    try {
      let error: any = null

      switch (item.type) {
        case 'create_encounter':
          ({ error } = await supabase.from('encounters').insert(item.data))
          break
        case 'update_encounter':
          ({ error } = await supabase.from('encounters').update(item.data).eq('id', item.data.id))
          break
        case 'create_prescription':
          ({ error } = await supabase.from('prescriptions').insert(item.data))
          break
        case 'create_patient':
          ({ error } = await supabase.from('patients').insert(item.data))
          break
      }

      if (error) {
        failed++
        console.warn(`[Sync] Failed to sync ${item.type}:`, error.message)
      } else {
        if (item.id) await removeSyncItem(item.id)
        synced++
      }
    } catch {
      failed++
    }
  }

  return { synced, failed }
}

// ─── Metadata ─────────────────────────────────────────────────

export async function getLastSyncTime(): Promise<string | null> {
  try {
    const meta = await getRecord(STORES.metadata, 'lastPatientSync')
    return meta?.value || null
  } catch {
    return null
  }
}

export async function getCacheStats(): Promise<{
  patients: number
  encounters: number
  pendingSync: number
  lastSync: string | null
}> {
  try {
    const patients = await getAllRecords(STORES.patients)
    const encounters = await getAllRecords(STORES.encounters)
    const syncQueue = await getAllRecords(STORES.syncQueue)
    const lastSync = await getLastSyncTime()

    return {
      patients: patients.length,
      encounters: encounters.length,
      pendingSync: syncQueue.length,
      lastSync,
    }
  } catch {
    return { patients: 0, encounters: 0, pendingSync: 0, lastSync: null }
  }
}
