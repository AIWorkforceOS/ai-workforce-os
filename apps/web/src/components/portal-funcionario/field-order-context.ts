'use client'

import { createContext, useContext } from 'react'

/** O que a ordem precisa saber do check-in por GPS (vem do FieldOrderShell; padrão = técnico sem check-in). */
export type FieldOrderApi = { requireGps: boolean; onFinished: (endedAt: string) => void }

export const FieldOrderContext = createContext<FieldOrderApi>({ requireGps: false, onFinished: () => {} })

export function useFieldOrder(): FieldOrderApi {
  return useContext(FieldOrderContext)
}
