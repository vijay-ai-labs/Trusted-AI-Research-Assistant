import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../')

describe('environment safety', () => {
  it('.env.example exists', () => {
    expect(() => readFileSync(resolve(ROOT, '.env.example'), 'utf8')).not.toThrow()
  })

  it('.env.example does not contain real OpenAI keys', () => {
    const content = readFileSync(resolve(ROOT, '.env.example'), 'utf8')
    // Real keys are long (50+ chars after sk-proj-)
    expect(content).not.toMatch(/sk-proj-[A-Za-z0-9_\-]{40,}/)
    // Placeholder "sk-...your-key-here..." is fine; real key pattern has no dots
    expect(content).not.toMatch(/OPENAI_API_KEY=sk-[A-Za-z0-9]{10,}/)
  })

  it('.env.example does not contain real OpenAlex keys (placeholder only)', () => {
    const content = readFileSync(resolve(ROOT, '.env.example'), 'utf8')
    // Should only have placeholder values like "your-openalex-key-here"
    expect(content).not.toMatch(/OPENALEX_API_KEY=[a-zA-Z0-9]{15,}[^-]/)
  })

  it('.gitignore exists and includes .env', () => {
    const content = readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
    expect(content).toContain('.env')
  })

  it('.gitignore includes node_modules and dist', () => {
    const content = readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules')
    expect(content).toContain('dist/')
  })
})
