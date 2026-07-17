'use client'

import { ErrorReport } from '@/components/diagnostics/error-report'

/**
 * Boundary de diagnóstico específico do dashboard — captura erros de
 * páginas como /dashboard/organizations/[id] sem derrubar a sidebar
 * (dashboard/layout.tsx continua renderizado ao redor). Ver
 * src/components/diagnostics/error-report.tsx.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorReport error={error} reset={reset} compact />
}
