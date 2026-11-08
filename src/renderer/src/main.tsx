import './assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ThemeSync } from '@/components/theme-toggle'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeSync />
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="bottom-left" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
