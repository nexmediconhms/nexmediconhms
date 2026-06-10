/**
 * src/components/opd/PatientEducation.tsx
 *
 * Patient education handout selector.
 * Doctor/staff can select and print condition-specific handouts.
 *
 * Usage:
 *   <PatientEducation patientId={id} encounterId={encId} />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useRef } from 'react';
import {
  EDUCATION_HANDOUTS,
  generateHandoutHtml,
  type EducationHandout,
} from '@/lib/patient-education';

interface PatientEducationProps {
  patientId: string;
  encounterId?: string;
  clinicName?: string;
  doctorName?: string;
}

export default function PatientEducation({
  patientId,
  encounterId,
  clinicName,
  doctorName,
}: PatientEducationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<EducationHandout | null>(null);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const categories = [...new Set(EDUCATION_HANDOUTS.map(h => h.category))];

  const handlePrint = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
    // Log that education was given
    if (selected) {
      fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'education',
          action: 'log',
          patient_id: patientId,
          encounter_id: encounterId,
          handout_code: selected.code,
          handout_title: language === 'hi' ? selected.title_hi : selected.title_en,
          language,
          delivery_method: 'print',
        }),
      }).catch(() => {});
    }
  }, [selected, patientId, encounterId, language]);

  const previewHtml = selected
    ? generateHandoutHtml(selected, language, clinicName, doctorName)
    : '';

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">📄 Patient Education</h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          {isOpen ? 'Close' : 'Give Handout'}
        </button>
      </div>

      {isOpen && !selected && (
        <div className="p-4">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setLanguage('en')} className={`text-xs px-2 py-1 rounded ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>English</button>
            <button onClick={() => setLanguage('hi')} className={`text-xs px-2 py-1 rounded ${language === 'hi' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>हिंदी</button>
          </div>
          {categories.map(cat => (
            <div key={cat} className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">{cat}</h4>
              <div className="space-y-1">
                {EDUCATION_HANDOUTS.filter(h => h.category === cat).map(h => (
                  <button
                    key={h.code}
                    onClick={() => setSelected(h)}
                    className="w-full text-left px-3 py-2 text-sm border rounded-md hover:bg-blue-50"
                  >
                    <span className="mr-2">{h.icon}</span>
                    {language === 'hi' ? h.title_hi : h.title_en}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800 text-sm">
              {selected.icon} {language === 'hi' ? selected.title_hi : selected.title_en}
            </h4>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md">🖨 Print</button>
              <button onClick={() => setSelected(null)} className="text-xs px-3 py-1 bg-gray-200 rounded-md">← Back</button>
            </div>
          </div>
          <iframe
            ref={iframeRef}
            srcDoc={previewHtml}
            className="w-full h-[400px] border rounded-md bg-white"
            title="Education Handout"
          />
        </div>
      )}
    </div>
  );
}
