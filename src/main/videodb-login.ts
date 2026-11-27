import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'
import { shell } from 'electron'

// DirectorFE's deployed OAuth 2.1 service owns browser sign-in and PKCE exchange.
const ORIGIN = 'https://console.videodb.io'
async function loginResponse(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 404)
    throw new Error(
      'VideoDB sign-in is not available on the server yet. Please try again after the service is updated.'
    )
  if (response.status >= 500)
    throw new Error('VideoDB sign-in is temporarily unavailable. Please try again shortly.')
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new Error('VideoDB sign-in returned an unexpected response. Please try again shortly.')
  }
}

let cancelPending: (() => void) | undefined
export function cancelVideoDbLogin(): void {
  cancelPending?.()
}

export async function loginVideoDb(): Promise<string> {
  cancelVideoDbLogin()
  const verifier = randomBytes(48).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let redirect = ''
  let clientId = ''
  let accepting = true
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const server = createServer()
  const result = new Promise<string>((resolve, reject) => {
    const finish = (error?: Error, key?: string): void => {
      accepting = false
      clearTimeout(timer)
      controller.abort()
      server.close()
      if (cancelPending === cancel) cancelPending = undefined
      if (error) reject(error)
      else resolve(key!)
    }
    const cancel = (): void => finish(new Error('VideoDB sign-in cancelled.'))
    cancelPending = cancel
    timer = setTimeout(
      () => finish(new Error('Sign-in timed out. Please start sign-in again.')),
      5 * 60 * 1000
    )
    server.on('error', () => finish(new Error('Could not start the local sign-in callback.')))
    server.on('request', async (req, res) => {
      const url = new URL(req.url ?? '/', redirect || 'http://127.0.0.1')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      if (
        !accepting ||
        req.method !== 'GET' ||
        url.pathname !== '/callback' ||
        url.searchParams.get('state') !== state ||
        url.searchParams.get('iss') !== ORIGIN
      ) {
        res.writeHead(400).end('Invalid sign-in callback. Return to Cutroom and try again.')
        return
      }
      accepting = false
      const code = url.searchParams.get('code')
      if (!code || url.searchParams.has('error')) {
        res.end('Sign-in was not completed. Return to Cutroom.')
        finish(new Error('VideoDB sign-in was declined.'))
        return
      }
      try {
        const response = await fetch(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: redirect
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
        })
        const body = await loginResponse(response)
        if (controller.signal.aborted) return
        if (!response.ok || typeof body.access_token !== 'string' || !body.access_token)
          throw new Error('Desktop sign-in could not complete. Please try signing in again.')
        res.end('Connected. You can close this tab and return to Cutroom.')
        finish(undefined, body.access_token)
      } catch (e) {
        res.end('Could not complete sign-in. Return to Cutroom to retry.')
        finish(e as Error)
      }
    })
    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('No callback address')
        redirect = `http://127.0.0.1:${address.port}/callback`
        const response = await fetch(`${ORIGIN}/oauth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Cutroom',
            redirect_uris: [redirect],
            token_endpoint_auth_method: 'none'
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        })
        const body = await loginResponse(response)
        if (controller.signal.aborted) return
        if (!response.ok || typeof body.client_id !== 'string')
          throw new Error('Could not start VideoDB sign-in. Please try signing in again.')
        clientId = body.client_id
        const query = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirect,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          scope: 'videodb',
          signup_app: 'cutroom'
        })
        await shell.openExternal(`${ORIGIN}/oauth/authorize?${query}`)
      } catch (e) {
        finish(e as Error)
      }
    })
  })
  return result
}
