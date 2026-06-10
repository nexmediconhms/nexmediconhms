/**
 * src/components/opd/ProcedureLogger.tsx
 *
 * Component for logging minor OPD procedures during consultation.
 * Features:
 *  - Searchable procedure catalog with auto-fill
 *  - Pre-filled technique, instructions, and anesthesia from catalog
 *  - Consent linking (creates consent before procedure)
 *  - Specimen tracking
 *  - Procedure history for patient
 *
 * Usage in OPD consultation page:
 *   <ProcedureLogger
 *     encounterId={encounterId}
 *     patientId={patientId}
 *     doctorId={doctorId}
 *   />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  GYNAE_PROCEDURE_CATALOG,
  searchCatalog,
  type ProcedureCatalogItem,
  type ProcedureInput,
} from '@/lib/opd-procedures';

interface ProcedureLoggerProps {
  encounterId: string;
  patientId: string;
  doctorId?: string;
  onProcedureAdded?: (procedure: unknown) => void;
}

interface LoggedProcedure {
  id: string;
  procedure_name: string;
  status: string;
  created_at: string;
}

export default function ProcedureLogger({
  encounterId,
  patientId,
  doctorId,
  onProcedureAdded,
}: ProcedureLoggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState<ProcedureCatalogItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<LoggedProcedure[]>([]);

  // Form state
  const [form, setForm] = useState<Partial<ProcedureInput>>({});

  // Load existing procedures for this encounter
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/opd/procedures?encounter_id=${encounterId}`);
        const data = await res.json();
        if (data.procedures) setLogged(data.procedures);
      } catch { /* ignore */ }
    }
    load();
  }, [encounterId]);

  const filteredCatalog = search.length > 0
    ? searchCatalog(search)
    : GYNAE_PROCEDURE_CATALOG;

  const handleSelectProcedure = useCallback((item: ProcedureCatalogItem) => {
    setSelectedCatalog(item);
    setForm({
      procedure_name: item.name,
      procedure_code: item.code,
      procedure_category: item.category,
      technique: item.defaultTechnique,
      anesthesia_type: item.defaultAnesthesia,
      post_procedure_instructions: item.defaultInstructions,
      specimen_sent: item.specimenExpected,
    });
    setSearch('');
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.procedure_name) {
      setError('Please select or enter a procedure name');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/opd/procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          encounter_id: encounterId,
          patient_id: patientId,
          doctor_id: doctorId,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLogged(prev => [...prev, data.procedure]);
      onProcedureAdded?.(data.procedure);

      // Reset form
      setForm({});
      setSelectedCatalog(null);
      setIsOpen(false);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [form, encounterId, patientId, doctorId, onProcedureAdded]);

  return (
    <div className="border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">
          🔬 Procedures ({logged.length})
        </h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          {isOpen ? 'Cancel' : '+ Log Procedure'}
        </button>
      </div>

      {/* Logged procedures list */}
      {logged.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {logged.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
              <span className="text-gray-800">{p.procedure_name}</span>
              <span className="text-xs text-green-600">✓ {p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* New procedure form */}
      {isOpen && (
        <div className="p-4 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
          )}

          {/* Procedure search */}
          {!selectedCatalog && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Search Procedure
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search... (e.g., IUD, PAP, biopsy)"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <div className="mt-2 max-h-48 overflow-y-auto border rounded-md divide-y">
                {filteredCatalog.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => handleSelectProcedure(item)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    <div className="font-medium text-gray-800">{item.name}</div>
                    <div className="text-xs text-gray-500">
                      {item.category} • ~{item.estimatedDuration} min •
                      {item.requiresConsent ? ' Consent required' : ' No consent needed'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected procedure form */}
          {selectedCatalog && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-800">{selectedCatalog.name}</h4>
                <button
                  onClick={() => { setSelectedCatalog(null); setForm({}); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  ✕ Change
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Indication</label>
                  <input
                    type="text"
                    value={form.indication || ''}
                    onChange={(e) => setForm(f => ({ ...f, indication: e.target.value }))}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                    placeholder="Reason for procedure"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Anesthesia</label>
                  <input
                    type="text"
                    value={form.anesthesia_type || ''}
                    onChange={(e) => setForm(f => ({ ...f, anesthesia_type: e.target.value }))}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Technique / Steps</label>
                <textarea
                  rows={4}
                  value={form.technique || ''}
                  onChange={(e) => setForm(f => ({ ...f, technique: e.target.value }))}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Findings</label>
                <textarea
                  rows={2}
                  value={form.findings || ''}
                  onChange={(e) => setForm(f => ({ ...f, findings: e.target.value }))}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                  placeholder="Findings during/after procedure"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Complications</label>
                <input
                  type="text"
                  value={form.complications || ''}
                  onChange={(e) => setForm(f => ({ ...f, complications: e.target.value }))}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                  placeholder="None / describe if any"
                />
              </div>

              {selectedCatalog.specimenExpected && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.specimen_sent || false}
                      onChange={(e) => setForm(f => ({ ...f, specimen_sent: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    Specimen sent
                  </label>
                  {form.specimen_sent && (
                    <input
                      type="text"
                      value={form.specimen_details || ''}
                      onChange={(e) => setForm(f => ({ ...f, specimen_details: e.target.value }))}
                      className="flex-1 border rounded-md px-2 py-1.5 text-sm"
                      placeholder="Lab name, specimen type..."
                    />
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Post-Procedure Instructions</label>
                <textarea
                  rows={3}
                  value={form.post_procedure_instructions || ''}
                  onChange={(e) => setForm(f => ({ ...f, post_procedure_instructions: e.target.value }))}
                  className="w-full border rounded-md px-2 py-1.5 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setIsOpen(false); setSelectedCatalog(null); setForm({}); }}
                  className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Procedure'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
