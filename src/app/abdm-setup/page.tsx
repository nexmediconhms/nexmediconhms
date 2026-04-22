'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { loadABDMConfig, saveABDMConfig, type ABDMConfig } from '@/lib/abdm'
import {
  Shield, CheckCircle, AlertCircle, ExternalLink, Info,
  Key, Globe, Server, ArrowLeft, Save, Loader2,
  FileText, Heart, Database, Wifi, WifiOff
} from 'lucide-react'

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export default function ABDMSetupPage() {
  const [config, setConfig] = useState<ABDMConfig>({
    clientId: '', clientSecret: '', environment: 'sandbox', enabled: false,
  })
  const [saved, setSaved]           = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg]       = useState('')

  useEffect(() => {
    setConfig(loadABDMConfig())
  }, [])

  function set(field: keyof ABDMConfig, value: any) {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    saveABDMConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function testConnection() {
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await fetch('/api/abdm/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId:     config.clientId,
          clientSecret: config.clientSecret,
          environment:  config.environment,
        }),
      })
      const data = await res.json()
      if (res.ok && data.accessToken) {
        setTestStatus('success')
        setTestMsg('Connection successful! ABDM gateway authenticated.')
      } else {
        setTestStatus('error')
        setTestMsg(data.error || 'Connection failed. Check your credentials.')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestMsg(`Network error: ${err.message}`)
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings" className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ABDM / ABHA Integration</h1>
            <p className="text-sm text-gray-500">Ayushman Bharat Digital Mission & HL7 FHIR R4 Setup</p>
          </div>
        </div>

        {saved && (
          <div className="mb-5 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Settings saved successfully.
          </div>
        )}

        {/* Overview */}
        <div className="mb-5 bg-blue-50 border border-blue-100 rounded-lg px-5 py-4 flex items-start gap-3 text-sm text-blue-700">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">What is ABDM?</p>
            <p>
              The <strong>Ayushman Bharat Digital Mission (ABDM)</strong> creates a digital health ecosystem in India.
              It enables patients to have a unique <strong>ABHA (Ayushman Bharat Health Account)</strong> number
              that links their health records across hospitals.
            </p>
            <p className="mt-2">
              <strong>HL7 FHIR R4</strong> is the international standard for health data exchange.
              NexMedicon converts patient records to FHIR format for interoperability with ABDM and other systems.
            </p>
          </div>
        </div>

        {/* Feature Status Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card p-4 text-center">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <Heart className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-sm font-semibold text-gray-900">ABHA Verification</div>
            <div className="text-xs text-gray-500 mt-1">Verify patient ABHA numbers during registration</div>
            <div className={`text-xs font-semibold mt-2 ${config.enabled ? 'text-green-600' : 'text-gray-400'}`}>
              {config.enabled ? '● Active' : '○ Not configured'}
            </div>
          </div>
          <div className="card p-4 text-center">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-sm font-semibold text-gray-900">FHIR R4 Export</div>
            <div className="text-xs text-gray-500 mt-1">Export patient records as FHIR bundles</div>
            <div className="text-xs font-semibold mt-2 text-green-600">● Always available</div>
          </div>
          <div className="card p-4 text-center">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <Database className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-sm font-semibold text-gray-900">Health Info Exchange</div>
            <div className="text-xs text-gray-500 mt-1">Share records via ABDM consent framework</div>
            <div className={`text-xs font-semibold mt-2 ${config.enabled ? 'text-green-600' : 'text-gray-400'}`}>
              {config.enabled ? '● Active' : '○ Not configured'}
            </div>
          </div>
        </div>

        {/* ABDM Credentials */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <Key className="w-4 h-4 text-green-600" /> ABDM Gateway Credentials
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Register at{' '}
            <a href="https://sandbox.abdm.gov.in" target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1">
              sandbox.abdm.gov.in <ExternalLink className="w-3 h-3" />
            </a>
            {' '}to get your Client ID and Secret. Use sandbox for testing, production for live patients.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="label w-32 flex-shrink-0">Enable ABDM</label>
              <button
                onClick={() => set('enabled', !config.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.enabled ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
              <span className="text-sm text-gray-500">
                {config.enabled ? 'ABDM integration is active' : 'ABDM integration is disabled'}
              </span>
            </div>

            <div>
              <label className="label">Environment</label>
              <div className="flex gap-3">
                <button
                  onClick={() => set('environment', 'sandbox')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    config.environment === 'sandbox'
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Server className="w-4 h-4" /> Sandbox (Testing)
                </button>
                <button
                  onClick={() => set('environment', 'production')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    config.environment === 'production'
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Globe className="w-4 h-4" /> Production (Live)
                </button>
              </div>
            </div>

            <div>
              <label className="label">Client ID</label>
              <input
                className="input font-mono"
                placeholder="e.g. SBX_XXXXXX"
                value={config.clientId}
                onChange={e => set('clientId', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Client Secret</label>
              <input
                className="input font-mono"
                type="password"
                placeholder="Your ABDM client secret"
                value={config.clientSecret}
                onChange={e => set('clientSecret', e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button onClick={handleSave} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> Save Settings
            </button>
            <button
              onClick={testConnection}
              disabled={!config.clientId || !config.clientSecret || testStatus === 'testing'}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              {testStatus === 'testing'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : testStatus === 'success'
                ? <Wifi className="w-4 h-4 text-green-500" />
                : testStatus === 'error'
                ? <WifiOff className="w-4 h-4 text-red-500" />
                : <Wifi className="w-4 h-4" />}
              Test Connection
            </button>
          </div>

          {testMsg && (
            <div className={`mt-3 text-sm px-4 py-2 rounded-lg flex items-center gap-2 ${
              testStatus === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {testStatus === 'success'
                ? <CheckCircle className="w-4 h-4" />
                : <AlertCircle className="w-4 h-4" />}
              {testMsg}
            </div>
          )}
        </div>

        {/* Environment Variables Note */}
        <div className="card p-5 mb-5 bg-gray-50 border-gray-200">
          <h2 className="section-title text-sm flex items-center gap-2">
            <Server className="w-4 h-4 text-gray-500" /> Server-Side Configuration (Recommended)
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            For production deployments, set these environment variables instead of using browser settings:
          </p>
          <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-xs space-y-1">
            <div><span className="text-gray-500"># .env.local or Vercel Environment Variables</span></div>
            <div>ABDM_CLIENT_ID=<span className="text-yellow-300">your_client_id</span></div>
            <div>ABDM_CLIENT_SECRET=<span className="text-yellow-300">your_client_secret</span></div>
            <div>ABDM_ENVIRONMENT=<span className="text-yellow-300">sandbox</span> <span className="text-gray-500"># or production</span></div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Server-side env vars take priority over browser settings and are more secure.
          </p>
        </div>

        {/* FHIR Info */}
        <div className="card p-6 mb-5">
          <h2 className="section-title flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" /> HL7 FHIR R4 Standard
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            NexMedicon automatically converts patient records to HL7 FHIR R4 format.
            This is the international standard used by ABDM for health data exchange.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-700 mb-1">Supported FHIR Resources</div>
              <ul className="text-xs text-blue-600 space-y-0.5">
                <li>• Patient (demographics, ABHA, Aadhaar)</li>
                <li>• Encounter (OPD/IPD visits)</li>
                <li>• Observation (vital signs — LOINC coded)</li>
                <li>• Condition (diagnoses)</li>
                <li>• MedicationRequest (prescriptions)</li>
                <li>• Composition (discharge summaries)</li>
                <li>• Bundle (collection export)</li>
              </ul>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-lg p-3">
              <div className="text-xs font-semibold text-green-700 mb-1">NDHM Profiles</div>
              <ul className="text-xs text-green-600 space-y-0.5">
                <li>• NRCES India FHIR profiles</li>
                <li>• LOINC vital sign codes</li>
                <li>• SNOMED CT encounter types</li>
                <li>• UCUM units of measure</li>
                <li>• ABHA identifier system</li>
                <li>• Aadhaar identifier system</li>
              </ul>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="text-xs font-semibold text-gray-700 mb-1">FHIR API Endpoint</div>
            <code className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              GET /api/fhir/patient/[patient-id]
            </code>
            <p className="text-xs text-gray-500 mt-1">
              Returns a FHIR R4 Bundle with all patient data. Add <code className="text-blue-600">?_summary=true</code> for Patient resource only.
            </p>
          </div>
        </div>

        {/* Database Migration */}
        <div className="card p-5 mb-5 bg-amber-50 border-amber-200">
          <h2 className="section-title text-sm flex items-center gap-2">
            <Database className="w-4 h-4 text-amber-600" /> Database Migration Required
          </h2>
          <p className="text-xs text-gray-600 mb-2">
            Run the following SQL migration in Supabase to add ABDM/FHIR columns:
          </p>
          <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs">
            <div className="text-gray-500">-- Run in Supabase → SQL Editor → New Query</div>
            <div className="text-yellow-300">supabase_v7_abdm_fhir.sql</div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            This adds ABHA number, ABHA address, KYC status, and consent management tables.
            Safe to run multiple times.
          </p>
        </div>

        {/* Quick Links */}
        <div className="card p-5">
          <h2 className="section-title text-sm">Quick Links</h2>
          <div className="grid grid-cols-2 gap-3">
            <a href="https://sandbox.abdm.gov.in" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> ABDM Sandbox Portal
            </a>
            <a href="https://abdm.gov.in" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> ABDM Official Website
            </a>
            <a href="https://nrces.in/ndhm/fhir/r4/index.html" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> NDHM FHIR Profiles (India)
            </a>
            <a href="https://hl7.org/fhir/R4/" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> HL7 FHIR R4 Specification
            </a>
          </div>
        </div>

      </div>
    </AppShell>
  )
}
