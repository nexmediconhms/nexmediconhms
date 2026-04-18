import Link from 'next/link'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-blue-100 mb-4 select-none">404</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
        <p className="text-gray-500 mb-8">
          The page you're looking for doesn't exist or may have been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/dashboard"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
            <Home className="w-4 h-4" /> Go to Dashboard
          </Link>
          <Link href="/patients"
            className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-lg border border-gray-200 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Patients List
          </Link>
        </div>
      </div>
    </div>
  )
}
