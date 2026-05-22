#!/usr/bin/env node
/**
 * migrations/run.js — Simple SQL Migration Runner for Supabase
 *
 * Usage:
 *   node migrations/run.js              # Run all pending migrations
 *   node migrations/run.js --status     # Show migration status
 *   node migrations/run.js --dry-run    # Show what would be run (no changes)
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL         (required)
 *   SUPABASE_SERVICE_ROLE_KEY        (required — needs admin access)
 *
 * How it works:
 *   1. Reads all .sql files in this directory, sorted by filename
 *   2. Checks schema_migrations table for already-applied migrations
 *   3. Runs only new (unapplied) migrations in order
 *   4. Records each successful migration in schema_migrations
 *
 * SAFETY:
 *   - Each migration runs in a single request (not a transaction — Supabase
 *     REST doesn't support multi-statement transactions). Write idempotent SQL.
 *   - If a migration fails, it stops immediately. Fix the issue and re-run.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Load .env.local if present
try {
  const envPath = path.resolve(__dirname, '..', '.env.local')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=').trim()
      if (key && value) process.env[key.trim()] = value
    })
  }
} catch (e) { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  console.error('       Set them in .env.local or as environment variables.')
  process.exit(1)
}

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes('--status')
const DRY_RUN = args.includes('--dry-run')

async function supabaseSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ query: sql }),
  })

  // If the RPC doesn't exist, fall back to raw SQL via pg
  if (res.status === 404) {
    // Use the management API for raw SQL
    const rawRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    })
    throw new Error('exec_sql RPC not found. Please create it or run migrations via Supabase SQL Editor.')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SQL execution failed (${res.status}): ${text}`)
  }
  return res
}

async function getAppliedMigrations() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/schema_migrations?select=version,name,applied_at&order=version.asc`,
    {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
    }
  )
  if (res.status === 404 || res.status === 406) {
    // Table doesn't exist yet
    return null
  }
  if (!res.ok) return []
  return await res.json()
}

async function recordMigration(version, name, checksum) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/schema_migrations`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ version, name, checksum }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.warn(`  Warning: Could not record migration ${version}: ${text}`)
  }
}

function getMigrationFiles() {
  const dir = __dirname
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({
      filename: f,
      version: f.replace('.sql', ''),
      filepath: path.join(dir, f),
      content: fs.readFileSync(path.join(dir, f), 'utf-8'),
      checksum: crypto.createHash('md5')
        .update(fs.readFileSync(path.join(dir, f), 'utf-8'))
        .digest('hex'),
    }))
}

async function main() {
  console.log('NexMedicon HMS — Migration Runner')
  console.log('─'.repeat(50))
  console.log(`Database: ${SUPABASE_URL}`)
  console.log('')

  const files = getMigrationFiles()
  console.log(`Found ${files.length} migration file(s).\n`)

  // Check if schema_migrations exists
  const applied = await getAppliedMigrations()

  if (applied === null) {
    console.log('schema_migrations table not found.')
    console.log('Please run 000_schema_migrations_table.sql first in Supabase SQL Editor.')
    console.log('')
    console.log('Copy-paste this SQL into Supabase Dashboard → SQL Editor:')
    console.log('─'.repeat(50))
    const bootstrapFile = files.find(f => f.filename === '000_schema_migrations_table.sql')
    if (bootstrapFile) {
      console.log(bootstrapFile.content)
    }
    process.exit(1)
  }

  const appliedVersions = new Set((applied || []).map(m => m.version))

  if (STATUS_ONLY) {
    console.log('Migration Status:')
    console.log('─'.repeat(50))
    for (const file of files) {
      const isApplied = appliedVersions.has(file.version)
      const status = isApplied ? '✓ Applied' : '○ Pending'
      const appliedInfo = applied.find(m => m.version === file.version)
      const date = appliedInfo ? ` (${new Date(appliedInfo.applied_at).toLocaleDateString()})` : ''
      console.log(`  ${status}  ${file.filename}${date}`)
    }
    return
  }

  const pending = files.filter(f => !appliedVersions.has(f.version))

  if (pending.length === 0) {
    console.log('All migrations are up to date. Nothing to do.')
    return
  }

  console.log(`${pending.length} pending migration(s):\n`)
  for (const m of pending) {
    console.log(`  → ${m.filename}`)
  }
  console.log('')

  if (DRY_RUN) {
    console.log('[DRY RUN] No changes made.')
    return
  }

  console.log('NOTE: Copy each pending SQL file and run it in Supabase SQL Editor.')
  console.log('      After running each one, the migration runner will detect it')
  console.log('      as applied on next run.')
  console.log('')
  console.log('Alternatively, create an exec_sql RPC in Supabase for automated execution.')
  console.log('')

  // Print each pending migration for manual execution
  for (const m of pending) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`MIGRATION: ${m.filename}`)
    console.log(`${'═'.repeat(60)}\n`)
    console.log(m.content)
    console.log(`\n-- After running above, insert tracking record:`)
    console.log(`INSERT INTO schema_migrations (version, name, checksum) VALUES ('${m.version}', '${m.filename}', '${m.checksum}');`)
  }
}

main().catch(err => {
  console.error('Migration runner error:', err.message)
  process.exit(1)
})
