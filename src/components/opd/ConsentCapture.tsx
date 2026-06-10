/**
 * src/components/opd/ConsentCapture.tsx
 *
 * Digital consent capture with signature pad.
 * Features:
 *  - Template selection (auto-fills consent body)
 *  - Bilingual support (English / Hindi)
 *  - Canvas-based signature capture (patient, guardian, witness)
 *  - Consent status tracking
 *
 * Usage:
 *   <ConsentCapture
 *     patientId={patientId}
 *     encounterId={encounterId}
 *     consentType="procedure_contraception"
 *     onConsentSigned={(consent) => { ... }}
 *   />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { CONSENT_TEMPLATES, getConsentTemplate, type ConsentTemplate } from '@/lib/consent-helpers';

interface ConsentCaptureProps {
  patientId: string;
  encounterId?: string;
  consentType?: string;
  doctorId?: string;
  doctorName?: string;
  onConsentSigned?: (consent: unknown) => void;
  onClose?: () => void;
}

export default function ConsentCapture({
  patientId,
  encounterId,
  consentType,
  doctorId,
  doctorName,
  onConsentSigned,
  onClose,
}: ConsentCaptureProps) {
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [selectedTemplate, setSelectedTemplate] = useState<ConsentTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelation, setGuardianRelation] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signature canvases
  const patientCanvasRef = useRef<HTMLCanvasElement>(null);
  const guardianCanvasRef = useRef<HTMLCanvasElement>(null);
  const witnessCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeCanvas, setActiveCanvas] = useState<HTMLCanvasElement | null>(null);

  // Auto-select template if consentType is provided
  useEffect(() => {
    if (consentType) {
      const tmpl = CONSENT_TEMPLATES.find(t => t.type === consentType);
      if (tmpl) handleSelectTemplate(tmpl);
    }
  }, [consentType]);

  const handleSelectTemplate = useCallback((tmpl: ConsentTemplate) => {
    setSelectedTemplate(tmpl);
    const content = getConsentTemplate(tmpl.id, language);
    if (content) {
      setTitle(content.title);
      setBody(content.body);
    }
  }, [language]);

  // Signature drawing handlers
  const getCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    setIsDrawing(true);
    setActiveCanvas(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const { x, y } = getCoords(e, canvas);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !activeCanvas) return;
    const ctx = activeCanvas.getContext('2d');
    if (ctx) {
      const { x, y } = getCoords(e, activeCanvas);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDraw = () => {
    setIsDrawing(false);
    setActiveCanvas(null);
  };

  const clearCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const getSignatureData = (canvas: HTMLCanvasElement | null): string | undefined => {
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    // Check if canvas has any drawing
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasContent = data.some((val, i) => i % 4 === 3 && val > 0);
    return hasContent ? canvas.toDataURL('image/png') : undefined;
  };

  const handleSave = useCallback(async () => {
    const patientSig = getSignatureData(patientCanvasRef.current);
    const guardianSig = getSignatureData(guardianCanvasRef.current);
    const witnessSig = getSignatureData(witnessCanvasRef.current);

    if (!patientSig && !guardianSig) {
      setError('At least one signature (patient or guardian) is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          encounter_id: encounterId,
          consent_type: selectedTemplate?.type || consentType || 'general',
          consent_title: title,
          consent_body: body,
          consent_template_id: selectedTemplate?.id,
          language,
          patient_signature: patientSig,
          guardian_name: guardianName || undefined,
          guardian_relation: guardianRelation || undefined,
          guardian_signature: guardianSig,
          witness_name: witnessName || undefined,
          witness_signature: witnessSig,
          doctor_id: doctorId,
          doctor_name: doctorName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onConsentSigned?.(data.consent);
      onClose?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [
    patientId, encounterId, consentType, selectedTemplate,
    title, body, language, guardianName, guardianRelation,
    witnessName, doctorId, doctorName, onConsentSigned, onClose,
  ]);

  return (
    <div className="bg-white border rounded-lg overflow-hidden max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">📝 Digital Consent</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLanguage('en'); if (selectedTemplate) handleSelectTemplate(selectedTemplate); }}
            className={`text-xs px-2 py-1 rounded ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}
          >
            English
          </button>
          <button
            onClick={() => { setLanguage('hi'); if (selectedTemplate) handleSelectTemplate(selectedTemplate); }}
            className={`text-xs px-2 py-1 rounded ${language === 'hi' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}
          >
            हिंदी
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

        {/* Template selector */}
        {!selectedTemplate && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Select Consent Type</label>
            <div className="grid grid-cols-1 gap-2">
              {CONSENT_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => handleSelectTemplate(tmpl)}
                  className="text-left px-3 py-2 border rounded-md hover:bg-blue-50 text-sm"
                >
                  {language === 'hi' ? tmpl.title_hi : tmpl.title_en}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Consent content */}
        {selectedTemplate && (
          <>
            <div>
              <h4 className="font-semibold text-gray-800 text-sm mb-2">{title}</h4>
              <div className="bg-gray-50 border rounded-md p-3 text-sm text-gray-700 whitespace-pre-line max-h-48 overflow-y-auto">
                {body}
              </div>
            </div>

            {/* Patient signature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-500">Patient Signature</label>
                <button onClick={() => clearCanvas(patientCanvasRef.current)} className="text-xs text-red-500">Clear</button>
              </div>
              <canvas
                ref={patientCanvasRef}
                width={500} height={100}
                className="w-full border-2 border-dashed border-gray-300 rounded-md cursor-crosshair bg-white touch-none"
                onMouseDown={(e) => startDraw(e, patientCanvasRef.current!)}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={(e) => { e.preventDefault(); startDraw(e, patientCanvasRef.current!); }}
                onTouchMove={(e) => { e.preventDefault(); draw(e); }}
                onTouchEnd={stopDraw}
              />
            </div>

            {/* Guardian (if required) */}
            {selectedTemplate.requiresGuardian && (
              <div className="border-t pt-3">
                <h5 className="text-xs font-medium text-gray-500 mb-2">Guardian / Attendant</h5>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="text" placeholder="Guardian name"
                    value={guardianName} onChange={(e) => setGuardianName(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-sm"
                  />
                  <input
                    type="text" placeholder="Relation (e.g., Husband)"
                    value={guardianRelation} onChange={(e) => setGuardianRelation(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500">Guardian Signature</label>
                  <button onClick={() => clearCanvas(guardianCanvasRef.current)} className="text-xs text-red-500">Clear</button>
                </div>
                <canvas
                  ref={guardianCanvasRef}
                  width={500} height={100}
                  className="w-full border-2 border-dashed border-gray-300 rounded-md cursor-crosshair bg-white touch-none"
                  onMouseDown={(e) => startDraw(e, guardianCanvasRef.current!)}
                  onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={(e) => { e.preventDefault(); startDraw(e, guardianCanvasRef.current!); }}
                  onTouchMove={(e) => { e.preventDefault(); draw(e); }}
                  onTouchEnd={stopDraw}
                />
              </div>
            )}

            {/* Witness */}
            {selectedTemplate.requiresWitness && (
              <div className="border-t pt-3">
                <h5 className="text-xs font-medium text-gray-500 mb-2">Witness</h5>
                <input
                  type="text" placeholder="Witness name"
                  value={witnessName} onChange={(e) => setWitnessName(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm mb-2"
                />
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500">Witness Signature</label>
                  <button onClick={() => clearCanvas(witnessCanvasRef.current)} className="text-xs text-red-500">Clear</button>
                </div>
                <canvas
                  ref={witnessCanvasRef}
                  width={500} height={100}
                  className="w-full border-2 border-dashed border-gray-300 rounded-md cursor-crosshair bg-white touch-none"
                  onMouseDown={(e) => startDraw(e, witnessCanvasRef.current!)}
                  onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={(e) => { e.preventDefault(); startDraw(e, witnessCanvasRef.current!); }}
                  onTouchMove={(e) => { e.preventDefault(); draw(e); }}
                  onTouchEnd={stopDraw}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {selectedTemplate && (
        <div className="px-4 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button
            onClick={() => { setSelectedTemplate(null); onClose?.(); }}
            className="px-4 py-2 text-sm text-gray-600 bg-white border rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Sign Consent'}
          </button>
        </div>
      )}
    </div>
  );
}
