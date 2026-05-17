'use client'
/**
 * src/lib/patient-context.tsx
 *
 * Global Patient Context — solves the problem of staff having to
 * re-enter patient name/ID in every module (billing, labs, prescriptions, etc.)
 *
 * How it works:
 *  1. When a patient is selected ANYWHERE in the app (OPD, search, registration),
 *     call setActivePatient(patient) — this stores it in React Context + sessionStorage.
 *  2. Every module that needs a patient can call usePatientContext() and get the
 *     active patient without asking the staff to search again.
 *  3. The active patient banner shows at the top of all pages so staff always
 *     knows who they're working with.
 *  4. Staff can clear the patient with one click when done.
 *
 * This does NOT break any existing URL-param-based flows — those still work.
 * This is an ADDITIONAL convenience layer on top.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export interface ActivePatient {
  id: string
  full_name: string
  mrn: string
  age?: number | string
  gender?: string
  mobile?: string
  blood_group?: string
  abha_id?: string
}

interface PatientContextType {
  activePatient: ActivePatient | null
  setActivePatient: (patient: ActivePatient | null) => void
  clearPatient: () => void
  isPatientActive: boolean
}

const PatientContext = createContext<PatientContextType>({
  activePatient: null,
  setActivePatient: () => {},
  clearPatient: () => {},
  isPatientActive: false,
})

export function usePatientContext() {
  return useContext(PatientContext)
}

const STORAGE_KEY = 'nexmedicon-active-patient'

export function PatientProvider({ children }: { children: ReactNode }) {
  const [activePatient, setActivePatientState] = useState<ActivePatient | null>(null)

  // Load from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Validate it has minimum required fields
        if (parsed && parsed.id && parsed.full_name && parsed.mrn) {
          setActivePatientState(parsed)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  const setActivePatient = useCallback((patient: ActivePatient | null) => {
    setActivePatientState(patient)
    try {
      if (patient) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(patient))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // sessionStorage might be unavailable
    }
  }, [])

  const clearPatient = useCallback(() => {
    setActivePatientState(null)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  return (
    <PatientContext.Provider value={{
      activePatient,
      setActivePatient,
      clearPatient,
      isPatientActive: activePatient !== null,
    }}>
      {children}
    </PatientContext.Provider>
  )
}
