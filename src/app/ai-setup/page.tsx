'use client'
import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import {
  CheckCircle, XCircle, AlertTriangle, Loader2,
  RefreshCw, ExternalLink, Copy, ChevronRight
} from 'lucide-react'

interface TestResult {
  ok:          boolean
  step:        string
  error?:      string
  error2?:     string
  model?:      string
  response?:   string
  key_preview?: string
  key_length?: number
}

export default function AISetupPage() {
  const [result,  setResult]  = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied,  setCopied]  = useState('')

  useEffect(() => { test() }, [])

  async function test() {
    setLoading(true)
    setResult(null)
    try {
      const r = await fetch('/api/test-ai')
      setResult(await r.json())
    } catch {
      setResult({ ok: false, step: 'network_error', error: 'Could not reach /api/test-ai — is the dev server running?' })
    }
    setLoading(false)
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(''), 2000)
  }

  function CodeBlock({ code, id }: { code: string; id: string }) {
    return (
      <div className="relative bg-gray-900 text-green-400 rounded-lg px-4 py-3 font-mono text-sm mt-2 mb-1 group">
        <span>{code}</span>
        <button onClick={() => copy(code, id)}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-all p-1 rounded">
          <Copy className="w-3.5 h-3.5"/>
        </button>
        {copied === id && <span className="absolute right-8 top-2.5 text-xs text-green-400">Copied!</span>}
      </div>
    )
  }

  const StatusIcon = () => {
    if (loading) return <Loader2 className="w-8 h-8 text-blue-500 animate-spin"/>
    if (!result) return null
    if (result.ok) return <CheckCircle className="w-8 h-8 text-green-500"/>
    return <XCircle className="w-8 h-8 text-red-500"/>
  }

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">AI Features Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Diagnose and fix: OCR scanning, AI summaries, discharge AI, voice correction
          </p>
        </div>

        {/* Status card */}
        <div className={`card p-6 mb-6 border-2 ${
          loading       ? 'border-blue-200 bg-blue-50'  :
          result?.ok    ? 'border-green-200 bg-green-50' :
          result        ? 'border-red-200 bg-red-50'    :
          'border-gray-200'
        }`}>
          <div className="flex items-center gap-4">
            <StatusIcon/>
            <div>
              {loading && <p className="font-semibold text-blue-800">Testing Anthropic API connection…</p>}
              {result?.ok && (
                <>
                  <p className="font-semibold text-green-800">✓ AI features are working</p>
                  <p className="text-sm text-green-700">
                    Connected to <code className="bg-green-100 px-1 rounded">{result.model}</code>
                    {result.key_preview && ` · Key: ${result.key_preview}`}
                  </p>
                </>
              )}
              {result && !result.ok && (
                <>
                  <p className="font-semibold text-red-800">
                    {result.step === 'key_placeholder' && '⚠ API key is still a placeholder'}
                    {result.step === 'key_missing'     && '⚠ API key not set'}
                    {result.step === 'api_call_failed' && '✗ API call failed'}
                    {result.step === 'network_error'   && '✗ Network error'}
                  </p>
                  <p className="text-sm text-red-700 mt-0.5">{result.error}</p>
                </>
              )}
            </div>
            <button onClick={test} disabled={loading}
              className="ml-auto btn-secondary text-xs flex items-center gap-1 flex-shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
              Re-test
            </button>
          </div>
        </div>

        {/* Fix steps — shown when key is placeholder or missing */}
        {result && !result.ok && (result.step === 'key_placeholder' || result.step === 'key_missing') && (
          <div className="space-y-5">
            <div className="card p-5 border-l-4 border-orange-400">
              <h2 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500"/>
                How to fix — 3 steps (takes 2 minutes)
              </h2>

              <div className="space-y-4">
                {/* Step 1 */}
                <div>
                  <div className="flex items-center gap-2 font-semibold text-gray-800 mb-1">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                    Get your Anthropic API key
                  </div>
                  <p className="text-sm text-gray-600 ml-8">
                    Go to{' '}
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
                      className="text-blue-600 underline font-medium inline-flex items-center gap-1">
                      console.anthropic.com → API Keys <ExternalLink className="w-3 h-3"/>
                    </a>
                    {' '}→ click <strong>Create Key</strong> → copy the key (starts with <code className="bg-gray-100 px-1 rounded">sk-ant-api03-</code>)
                  </p>
                </div>

                {/* Step 2 */}
                <div>
                  <div className="flex items-center gap-2 font-semibold text-gray-800 mb-1">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                    Open <code className="bg-gray-100 px-1 rounded font-mono text-sm">.env.local</code> in your project folder
                  </div>
                  <p className="text-sm text-gray-600 ml-8 mb-1">
                    The file is at <code className="bg-gray-100 px-1 rounded">hms-mvp/.env.local</code> — open it in any text editor (Notepad, VS Code, etc.)
                  </p>
                  <div className="ml-8">
                    <p className="text-xs text-gray-500 mb-1">Find this line:</p>
                    <CodeBlock code="ANTHROPIC_API_KEY=sk-ant-YOUR_REAL_KEY_HERE" id="old"/>
                    <p className="text-xs text-gray-500 mb-1 mt-2">Replace it with:</p>
                    <CodeBlock code="ANTHROPIC_API_KEY=sk-ant-api03-YOUR_ACTUAL_KEY" id="new"/>
                    <p className="text-xs text-gray-400 mt-1">
                      (paste your actual key from Step 1 — keep everything else in the file unchanged)
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div>
                  <div className="flex items-center gap-2 font-semibold text-gray-800 mb-1">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                    Restart the dev server
                  </div>
                  <p className="text-sm text-gray-600 ml-8 mb-1">
                    In your terminal, press <kbd className="bg-gray-100 border border-gray-300 px-2 py-0.5 rounded text-xs font-mono">Ctrl + C</kbd> to stop the server, then run:
                  </p>
                  <div className="ml-8">
                    <CodeBlock code="npm run dev" id="dev"/>
                  </div>
                  <p className="text-sm text-gray-600 ml-8 mt-2">
                    Then come back to this page and click <strong>Re-test</strong> — you should see a green checkmark.
                  </p>
                </div>
              </div>
            </div>

            {/* FAQ */}
            <div className="card p-5 bg-gray-50">
              <h3 className="font-semibold text-gray-700 mb-3">Common questions</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-gray-800">Is the Anthropic API free?</p>
                  <p className="text-gray-500">New accounts get $5 free credit — enough for hundreds of OCR scans. After that, OCR costs ~₹0.30 per scan. See <a href="https://anthropic.com/pricing" target="_blank" rel="noreferrer" className="text-blue-600 underline">anthropic.com/pricing</a>.</p>
                </div>
                <div>
                  <p className="font-medium text-gray-800">Which features need the key?</p>
                  <p className="text-gray-500">OCR form scanning, AI patient summary, AI discharge summary, voice input correction. Everything else (patient records, billing, appointments) works without it.</p>
                </div>
                <div>
                  <p className="font-medium text-gray-800">Is the key safe in .env.local?</p>
                  <p className="text-gray-500">.env.local is never committed to git and never sent to the browser. It's only read server-side. It's safe for local dev and Vercel deployments.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Key works but API call failed */}
        {result && !result.ok && result.step === 'api_call_failed' && (
          <div className="card p-5 border-l-4 border-red-400">
            <h2 className="font-bold text-gray-900 mb-2">API call failed</h2>
            <p className="text-sm text-gray-600 mb-3">Your key was found but the API returned an error:</p>
            <div className="bg-gray-100 rounded p-3 font-mono text-xs text-red-700 mb-3">
              {result.error}<br/>
              {result.error2 && <span>{result.error2}</span>}
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <p>• <strong>401 / authentication_error</strong> — key is invalid or has been revoked. Create a new one at console.anthropic.com</p>
              <p>• <strong>429 / rate_limit_error</strong> — too many requests. Wait 30 seconds and re-test</p>
              <p>• <strong>500 / overloaded</strong> — Anthropic API is busy. Try again in a minute</p>
            </div>
          </div>
        )}

        {/* Success */}
        {result?.ok && (
          <div className="card p-5 bg-green-50 border-green-200">
            <h2 className="font-bold text-green-800 mb-3">All AI features are ready ✓</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['📷 OCR Form Scanning',     'Scan paper forms → auto-fill patient data'],
                ['🧠 AI Patient Summary',    'One-click clinical summary from visit history'],
                ['📋 AI Discharge Summary',  'Auto-generated discharge documents'],
                ['🎙️ Voice Input Correction', 'Speech-to-text with medical terminology fix'],
              ].map(([title, desc]) => (
                <div key={title} className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5"/>
                  <div>
                    <div className="font-medium text-green-800 text-xs">{title}</div>
                    <div className="text-green-600 text-xs">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
