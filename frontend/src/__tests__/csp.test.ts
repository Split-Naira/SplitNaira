/**
 * Regression tests for the Content-Security-Policy header (#1669).
 *
 * Reads the CSP value directly from next.config.mjs so the test fails
 * whenever a directive is removed or narrowed without an intentional review.
 */
import { describe, it, expect } from 'vitest'

// Extract the CSP string from the config without booting Next.js.
// next.config.mjs exports a wrapped config; we read it via dynamic import.
async function getCspValue(): Promise<string> {
  // next.config.mjs re-exports through withSentryConfig/withNextIntl which
  // preserve the headers() function on the inner config. We call headers()
  // directly after resolving the module's default export chain.
  const mod = await import('../../next.config.mjs')
  const config = mod.default

  // The wrapped config still exposes headers() from the base nextConfig.
  if (typeof config.headers !== 'function') {
    throw new Error('next.config.mjs does not export a headers() function')
  }
  const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
    await config.headers()

  for (const rule of rules) {
    const header = rule.headers.find(
      (h: { key: string; value: string }) => h.key === 'Content-Security-Policy',
    )
    if (header) return header.value
  }
  throw new Error('No Content-Security-Policy header found in next.config.mjs headers()')
}

describe('Content-Security-Policy header', () => {
  it('is present', async () => {
    const csp = await getCspValue()
    expect(csp).toBeTruthy()
  })

  it('pins default-src to self', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/default-src[^;]*'self'/)
  })

  it('includes script-src with self', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/script-src[^;]*'self'/)
  })

  it('includes style-src', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/style-src/)
  })

  it('blocks framing via frame-ancestors none', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/frame-ancestors[^;]*'none'/)
  })

  it('allows data: URIs for images (wallet QR codes)', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/img-src[^;]*data:/)
  })

  it('allows HTTPS connect-src for RPC and API calls', async () => {
    const csp = await getCspValue()
    expect(csp).toMatch(/connect-src[^;]*https:/)
  })
})
