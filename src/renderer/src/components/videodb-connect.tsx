import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'

export function VideoDbConnect({
  onConnected
}: {
  onConnected: () => void | Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(
    () => () => {
      void window.api.settings.cancelLogin()
    },
    []
  )
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.settings.login()
      await onConnected()
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-2">
      <Button disabled={busy} onClick={() => void connect()}>
        <ExternalLink />
        {busy ? 'Waiting for browser…' : 'Sign in with VideoDB'}
      </Button>
      {busy && (
        <Button variant="ghost" size="sm" onClick={() => void window.api.settings.cancelLogin()}>
          Cancel sign-in
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        Choose your account in the browser. Cutroom and its agent will use this connection.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
