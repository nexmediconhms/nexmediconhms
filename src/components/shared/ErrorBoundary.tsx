'use client'
/**
 * ErrorBoundary — Component-level error boundary for graceful degradation.
 *
 * Unlike the global error.tsx (which catches whole-page errors), this component
 * can wrap individual sections so a failure in one area doesn't crash the whole page.
 *
 * USE CASES:
 *   - Wrap the ANC risk calculator (so a calc error doesn't crash the page)
 *   - Wrap chart/analytics components (data visualization often has edge cases)
 *   - Wrap third-party integrations (ABDM, payment gateways)
 *
 * USAGE:
 *   <ErrorBoundary fallback="Unable to load analytics">
 *     <AnalyticsDashboard />
 *   </ErrorBoundary>
 */

import React, { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Custom fallback message or component */
  fallback?: ReactNode | string
  /** Called when an error is caught (for logging/reporting) */
  onError?: (error: Error, info: React.ErrorInfo) => void
  /** If true, shows a retry button */
  showRetry?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info)
    this.props.onError?.(error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'string') {
          return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-red-700 text-sm font-medium mb-2">
                <AlertTriangle className="w-4 h-4" />
                {this.props.fallback}
              </div>
              {this.props.showRetry !== false && (
                <button
                  onClick={this.handleRetry}
                  className="text-xs text-red-600 hover:text-red-800 underline flex items-center gap-1 mx-auto"
                >
                  <RefreshCw className="w-3 h-3" /> Try again
                </button>
              )}
            </div>
          )
        }
        return <>{this.props.fallback}</>
      }

      // Default fallback
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-500 mb-3">
            {this.state.error?.message || 'An unexpected error occurred in this section.'}
          </p>
          {this.props.showRetry !== false && (
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          )}
        </div>
      )
    }

    return this.props.children
  }
}