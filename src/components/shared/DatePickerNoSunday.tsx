'use client'
/**
 * src/components/shared/DatePickerNoSunday.tsx
 *
 * Reusable date picker that blocks Sunday selection.
 * Use this EVERYWHERE a date is selectable: appointments, follow-ups, OT surgery, etc.
 *
 * Features:
 *   - Prevents selecting any Sunday
 *   - Shows inline warning if user manually types a Sunday
 *   - Auto-shifts to Monday if a Sunday date is pasted/set programmatically
 *   - Works with native HTML date input (no dependencies)
 *   - Fully responsive
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isSunday } from '@/lib/utils'

interface DatePickerNoSundayProps {
  value: string
  onChange: (date: string) => void
  min?: string
  max?: string
  className?: string
  label?: string
  required?: boolean
  disabled?: boolean
  id?: string
}

export default function DatePickerNoSunday({
  value,
  onChange,
  min,
  max,
  className = 'input',
  label,
  required,
  disabled,
  id,
}: DatePickerNoSundayProps) {
  const [warning, setWarning] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Validate and handle change
  const handleChange = useCallback((dateStr: string) => {
    if (!dateStr) {
      onChange(dateStr)
      setWarning('')
      return
    }

    if (isSunday(dateStr)) {
      // Auto-shift to Monday
      const d = new Date(dateStr)
      d.setDate(d.getDate() + 1)
      const monday = d.toISOString().split('T')[0]
      onChange(monday)
      setWarning('Clinic is closed on Sundays. Auto-shifted to Monday.')
      setTimeout(() => setWarning(''), 4000)
    } else {
      onChange(dateStr)
      setWarning('')
    }
  }, [onChange])

  // Also validate if initial value is Sunday (edge case: preset from URL param)
  useEffect(() => {
    if (value && isSunday(value)) {
      const d = new Date(value)
      d.setDate(d.getDate() + 1)
      onChange(d.toISOString().split('T')[0])
    }
  }, []) // Only on mount

  return (
    <div>
      {label && <label className="label">{label}{required && ' *'}</label>}
      <input
        ref={inputRef}
        id={id}
        type="date"
        className={className}
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => {
          // Re-validate on blur (in case browser allowed picking Sunday)
          if (value && isSunday(value)) {
            handleChange(value)
          }
        }}
      />
      {warning && (
        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0" />
          {warning}
        </p>
      )}
    </div>
  )
}
