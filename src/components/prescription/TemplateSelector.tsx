'use client'

import { useState, useEffect, useRef } from 'react'
import { FileText, X, ChevronDown, Save, Pill } from 'lucide-react'
import { loadTemplates, saveTemplate, PrescriptionTemplate } from '@/lib/prescription-templates'

interface Medication {
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  instructions: string
}

interface TemplateSelectorProps {
  onSelect: (meds: Medication[], advice?: string, dietaryAdvice?: string, reportsNeeded?: string) => void
  onSaveTemplate?: (meds: Medication[], name: string, category: string) => void
}

const CATEGORIES = ['All', 'ANC', 'Gynae', 'General', 'Post-Op', 'Custom']

export default function TemplateSelector({ onSelect, onSaveTemplate }: TemplateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [templates, setTemplates] = useState<PrescriptionTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCategory, setSaveCategory] = useState('Custom')
  const [saving, setSaving] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      fetchTemplates()
    }
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  async function fetchTemplates() {
    setLoading(true)
    try {
      const data = await loadTemplates()
      setTemplates(data)
    } catch (err) {
      console.error('[TemplateSelector] Failed to load templates:', err)
    }
    setLoading(false)
  }

  function handleSelectTemplate(template: PrescriptionTemplate) {
    onSelect(
      template.medications as Medication[],
      template.advice,
      template.dietaryAdvice,
      template.reportsNeeded
    )
    setIsOpen(false)
  }

  async function handleSaveTemplate() {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      if (onSaveTemplate) {
        onSaveTemplate([], saveName.trim(), saveCategory)
      }
      await saveTemplate({
        name: saveName.trim(),
        category: saveCategory,
        description: `Custom template: ${saveName.trim()}`,
        medications: [],
      })
      setSaveName('')
      setShowSaveForm(false)
      await fetchTemplates()
    } catch (err) {
      console.error('[TemplateSelector] Failed to save template:', err)
    }
    setSaving(false)
  }

  const filteredTemplates = selectedCategory === 'All'
    ? templates
    : templates.filter(t => t.category === selectedCategory)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
      >
        <FileText className="w-4 h-4" />
        Load Template
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div
            ref={modalRef}
            className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg max-h-[80vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-gray-900">Prescription Templates</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-50 overflow-x-auto">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Template List */}
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">Loading templates...</span>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  No templates found in this category.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTemplates.map(template => (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800 group-hover:text-indigo-700">
                          {template.name}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Pill className="w-3 h-3" />
                          {template.medications.length} meds
                        </span>
                      </div>
                      {template.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {template.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          {template.category}
                        </span>
                        {template.advice && (
                          <span className="text-[10px] text-gray-400">+ advice</span>
                        )}
                        {template.reportsNeeded && (
                          <span className="text-[10px] text-gray-400">+ reports</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Save Template Section */}
            <div className="border-t border-gray-100 px-4 py-3">
              {!showSaveForm ? (
                <button
                  onClick={() => setShowSaveForm(true)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Current Prescription as Template
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      placeholder="Template name..."
                      className="flex-1 text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    />
                    <select
                      value={saveCategory}
                      onChange={e => setSaveCategory(e.target.value)}
                      className="text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    >
                      <option value="ANC">ANC</option>
                      <option value="Gynae">Gynae</option>
                      <option value="General">General</option>
                      <option value="Post-Op">Post-Op</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveTemplate}
                      disabled={!saveName.trim() || saving}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      {saving ? 'Saving...' : 'Save Template'}
                    </button>
                    <button
                      onClick={() => { setShowSaveForm(false); setSaveName('') }}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}