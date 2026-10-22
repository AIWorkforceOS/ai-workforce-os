import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable().optional()

/** Campos editáveis do perfil do cliente. O NOME não muda depois de criado (é a chave que liga o cliente às ordens). */
export const clientProfileFields = {
  address_line1: text(200),
  address_line2: text(200),
  phone: text(40),
  email: z.union([z.literal(''), z.string().trim().max(120).email()]).transform((v) => (v === '' ? null : v)).nullable().optional(),
  website: text(200),
  notes: text(1000),
  payment_terms_days: z.number().int().min(0).max(365).nullable().optional(),
}

export const createClientProfileSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cliente.').max(120),
  orgId: z.string().uuid().optional(),
  ...clientProfileFields,
})

export const updateClientProfileSchema = z.object({ ...clientProfileFields }).strict()
