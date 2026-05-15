/**
 * tests/setup.ts
 * 
 * Global test setup file. Runs before each test file.
 * Used to:
 *   - Set up environment variables needed by the code
 *   - Mock browser APIs (localStorage, sessionStorage)
 *   - Configure testing library extensions
 */

// Mock environment variables that the app expects
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

// Mock localStorage and sessionStorage for tests that use them
const mockStorage: Record<string, string> = {}
const storageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value },
  removeItem: (key: string) => { delete mockStorage[key] },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) },
  get length() { return Object.keys(mockStorage).length },
  key: (index: number) => Object.keys(mockStorage)[index] || null,
}

Object.defineProperty(global, 'localStorage', { value: storageMock })
Object.defineProperty(global, 'sessionStorage', { value: storageMock })
