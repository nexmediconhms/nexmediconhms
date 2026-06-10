/**
 * src/components/opd/LabOrderPanel.tsx
 *
 * Lab ordering component for use inside OPD consultation.
 * Features:
 *  - Search lab test catalog
 *  - Quick-select pre-defined panels (ANC Booking, PCOS Workup, etc.)
 *  - Batch ordering
 *  - View ordered/pending tests for this encounter
 *  - Urgency selector
 *
 * Usage in OPD consultation page:
 *   <LabOrderPanel
 *     encounterId={encounterId}
 *     patientId={patientId}
 *     doctorId={doctorId}
 *   />
 *
 * NON-BREAKING: New component. Existing labs page unaffected.
 */
'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  GYNAE_LAB_CATALOG,
  LAB_PANELS,
  LAB_STATUS_CONFIG,
  searchLabCatalog,
  getLabPanel,
  type LabTestCatalogItem,
  type LabOrder,
} from '@/lib/lab-order-helpers';

interface LabOrderPanelProps {
  encounterId: string;
  patientId: string;
  doctorId?: string;
  onOrderCreated?: (orders: LabOrder[]) => void;
}

export default function LabOrderPanel({
  encounterId,
  patientId,
  doctorId,
  onOrderCreated,
}: LabOrderPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTests, setSelectedTests] = useState<LabTestCatalogItem[]>([]);
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingOrders, setExistingOrders] = useState<LabOrder[]>([]);

  // Load existing orders for this encounter
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/lab-orders?encounter_id=${encounterId}`);
        const data = await res.json();
        if (data.lab_orders) setExistingOrders(data.lab_orders);
      } catch { /* ignore */ }
    }
    load();
  }, [encounterId]);

  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    return searchLabCatalog(search);
  }, [search]);

  const toggleTest = useCallback((test: LabTestCatalogItem) => {
    setSelectedTests(prev => {
      const exists = prev.find(t => t.code === test.code);
      if (exists) return prev.filter(t => t.code !== test.code);
      return [...prev, test];
    });
  }, []);

  const addPanel = useCallback((panelKey: string) => {
    const panel = getLabPanel(panelKey);
    if (!panel) return;
    setSelectedTests(prev => {
      const existing = new Set(prev.map(t => t.code));
      const newTests = panel.tests.filter(t => !existing.has(t.code));
      return [...prev, ...newTests];
    });
  }, []);

  const handleOrder = useCallback(async () => {
    if (selectedTests.length === 0) {
      setError('Please select at least one test');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const orders = selectedTests.map(test => ({
        patient_id: patientId,
        encounter_id: encounterId,
        test_name: test.name,
        test_code: test.code,
        test_category: test.category,
        urgency,
        clinical_notes: clinicalNotes || undefined,
        ordered_by: doctorId,
      }));

      const res = await fetch('/api/lab-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.errors?.join(', '));

      setExistingOrders(prev => [...prev, ...(data.lab_orders || [])]);
      onOrderCreated?.(data.lab_orders || []);

      // Reset
      setSelectedTests([]);
      setClinicalNotes('');
      setIsOpen(false);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [selectedTests, encounterId, patientId, doctorId, urgency, clinicalNotes, onOrderCreated]);

  const alreadyOrdered = new Set(existingOrders.map(o => o.test_code).filter(Boolean));

  return (
    <div className="border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">
          🧪 Lab Orders ({existingOrders.length})
        </h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {isOpen ? 'Cancel' : '+ Order Labs'}
        </button>
      </div>

      {/* Existing orders */}
      {existingOrders.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {existingOrders.map((order) => {
            const statusCfg = LAB_STATUS_CONFIG[order.status] || LAB_STATUS_CONFIG.ordered;
            return (
              <div key={order.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                <span className="text-gray-800">{order.test_name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusCfg.bgColor} ${statusCfg.color}`}>
                  {statusCfg.icon} {statusCfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Order form */}
      {isOpen && (
        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* Quick panels */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Quick Panels</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(LAB_PANELS).map(([key, panel]) => (
                <button
                  key={key}
                  onClick={() => addPanel(key)}
                  className="text-xs px-3 py-1.5 border border-blue-200 text-blue-700 rounded-full hover:bg-blue-50"
                >
                  + {panel.name} ({panel.tests.length})
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search Tests</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or code (e.g., TSH, CBC, AMH)..."
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            {searchResults.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto border rounded-md divide-y">
                {searchResults.map((test) => {
                  const isSelected = selectedTests.some(t => t.code === test.code);
                  const isOrdered = alreadyOrdered.has(test.code);
                  return (
                    <button
                      key={test.code}
                      onClick={() => !isOrdered && toggleTest(test)}
                      disabled={isOrdered}
                      className={`w-full text-left px-3 py-2 text-sm ${
                        isOrdered ? 'bg-gray-100 text-gray-400' :
                        isSelected ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{test.code}</span> — {test.name}
                      <span className="text-xs text-gray-400 ml-2">{test.category}</span>
                      {isOrdered && <span className="text-xs text-gray-400 ml-2">(already ordered)</span>}
                      {isSelected && <span className="text-blue-600 float-right">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected tests */}
          {selectedTests.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Selected Tests ({selectedTests.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedTests.map((test) => (
                  <span
                    key={test.code}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs"
                  >
                    {test.code}
                    <button
                      onClick={() => toggleTest(test)}
                      className="text-blue-500 hover:text-red-500 ml-1"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              {selectedTests.some(t => t.fasting) && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded p-2">
                  ⚠ Some tests require fasting: {selectedTests.filter(t => t.fasting).map(t => t.code).join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Urgency + notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Urgency</label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as typeof urgency)}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">STAT</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Clinical Notes</label>
              <input
                type="text"
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                placeholder="e.g., Rule out GDM"
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setIsOpen(false); setSelectedTests([]); }}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleOrder}
              disabled={saving || selectedTests.length === 0}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Ordering...' : `Order ${selectedTests.length} Test${selectedTests.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
