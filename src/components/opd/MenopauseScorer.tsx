/**
 * src/components/opd/MenopauseScorer.tsx
 *
 * Interactive MRS (Menopause Rating Scale) calculator.
 * 11-item validated scale with subscale analysis and treatment recommendations.
 *
 * Usage:
 *   <MenopauseScorer patientId={id} encounterId={encId} />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useMemo } from 'react';
import { MRS_ITEMS, MRS_SEVERITY_LABELS, calculateMRS, type ScoreResult } from '@/lib/clinical-scores';

interface MenopauseScorerProps {
  patientId: string;
  encounterId?: string;
  doctorId?: string;
  language?: 'en' | 'hi';
}

export default function MenopauseScorer({
  patientId,
  encounterId,
  doctorId,
  language = 'en',
}: MenopauseScorerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scores, setScores] = useState<Record<number, number>>({});
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentTotal = useMemo(() => {
    return Object.values(scores).reduce((sum, v) => sum + v, 0);
  }, [scores]);

  const handleCalculate = useCallback(() => {
    const r = calculateMRS(scores);
    setResult(r);
  }, [scores]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    try {
      await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'score',
          action: 'calculate',
          score_type: 'mrs',
          scores,
          patient_id: patientId,
          encounter_id: encounterId,
          scored_by: doctorId,
        }),
      });
      setSaved(true);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [result, scores, patientId, encounterId, doctorId]);

  const sevColor = (sev: string) => {
    switch (sev) {
      case 'none_minimal': return 'text-green-700 bg-green-50 border-green-200';
      case 'mild': return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'moderate': return 'text-orange-700 bg-orange-50 border-orange-200';
      case 'severe': return 'text-red-700 bg-red-50 border-red-200';
      default: return 'text-gray-700 bg-gray-50';
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">🌸 Menopause Rating Scale (MRS)</h3>
        <button onClick={() => setIsOpen(!isOpen)} className="text-xs px-3 py-1 bg-amber-600 text-white rounded-md hover:bg-amber-700">
          {isOpen ? 'Close' : 'Assess'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 space-y-4">
          {/* Instructions */}
          <p className="text-xs text-gray-500">
            Rate each symptom: 0 = None, 1 = Mild, 2 = Moderate, 3 = Severe, 4 = Very Severe
          </p>

          {/* Score items by subscale */}
          {(['somatic', 'psychological', 'urogenital'] as const).map(subscale => (
            <div key={subscale} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-gray-500 tracking-wide">
                {subscale === 'somatic' ? '🔥 Somatic' : subscale === 'psychological' ? '🧠 Psychological' : '💧 Urogenital'}
              </h4>
              {MRS_ITEMS.filter(i => i.subscale === subscale).map(item => (
                <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                  <div className="text-sm text-gray-800 flex-1">
                    {language === 'hi' ? item.label_hi : item.label_en}
                    <span className="text-xs text-gray-400 ml-1 block">{item.description_en}</span>
                  </div>
                  <div className="flex gap-1 ml-4">
                    {MRS_SEVERITY_LABELS.map(sev => (
                      <button
                        key={sev.value}
                        onClick={() => setScores(s => ({ ...s, [item.id]: sev.value }))}
                        className={`w-8 h-8 text-xs rounded-md border transition-colors ${
                          scores[item.id] === sev.value
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                        title={language === 'hi' ? sev.label_hi : sev.label}
                      >
                        {sev.value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Running total */}
          <div className="text-center text-sm text-gray-600">
            Current total: <span className="font-bold text-lg">{currentTotal}</span> / 44
          </div>

          {/* Calculate button */}
          <button
            onClick={handleCalculate}
            className="w-full py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
          >
            Calculate Score
          </button>

          {/* Result */}
          {result && (
            <div className={`border rounded-lg p-4 space-y-3 ${sevColor(result.severity)}`}>
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-lg">{result.totalScore} / {result.maxScore}</h4>
                <span className="text-sm font-semibold capitalize">{result.severity.replace('_', ' ')}</span>
              </div>

              <p className="text-sm">{result.interpretation}</p>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-white/50 rounded p-2 text-center">
                  <div className="font-semibold">{result.subscores.somatic}</div>
                  <div className="opacity-70">Somatic</div>
                </div>
                <div className="bg-white/50 rounded p-2 text-center">
                  <div className="font-semibold">{result.subscores.psychological}</div>
                  <div className="opacity-70">Psychological</div>
                </div>
                <div className="bg-white/50 rounded p-2 text-center">
                  <div className="font-semibold">{result.subscores.urogenital}</div>
                  <div className="opacity-70">Urogenital</div>
                </div>
              </div>

              {result.recommendations.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold uppercase opacity-70 mb-1">Recommendations</h5>
                  {result.recommendations.map((r, i) => (
                    <div key={i} className="text-xs py-0.5">• {r}</div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                {saved ? (
                  <span className="text-xs text-green-700">✓ Score saved to patient record</span>
                ) : (
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-1.5 text-xs bg-white border rounded-md hover:bg-gray-50 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save to Patient Record'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
