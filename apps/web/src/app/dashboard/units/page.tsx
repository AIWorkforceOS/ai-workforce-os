import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
import type { Unit } from '@/lib/types'
import { Plus, MapPin } from 'lucide-react'
import { Badge, Card, EmptyState, PageHeader, PrimaryButton, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'

export default async function UnitsPage() {
  const appUser = await getAppUser()

  // Dono de unidade não gerencia lista de unidades: a listagem seria uma
  // tabela de 1 linha (RLS só devolve a própria) e "Nova unidade" falharia
  // no RLS — vai direto pra tela da unidade dele.
  if (appUser?.unitId) {
    redirect(`/dashboard/units/${appUser.unitId}`)
  }

  const supabase = await createClient()
  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: false })

  const unitRows = (units ?? []) as Unit[]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="gestão"
        title="Unidades"
        subtitle="Gerencie as unidades cadastradas."
        action={
          <PrimaryButton href="/dashboard/units/new" icon={<Plus size={14} />}>
            Nova unidade
          </PrimaryButton>
        }
      />

      <Card className="overflow-hidden">
        {unitRows.length === 0 ? (
          <EmptyState
            icon={<MapPin size={22} className="text-white" />}
            title="Nenhuma unidade cadastrada"
            subtitle="Crie a primeira unidade para começar."
            actionHref="/dashboard/units/new"
            actionLabel="Criar unidade"
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <TableShell>
              <Th>Nome</Th>
              <Th>Cidade / Estado</Th>
              <Th>WhatsApp</Th>
              <Th>Status</Th>
              <Th>Conexão</Th>
            </TableShell>
            <tbody>
              {unitRows.map((unit) => (
                <Tr key={unit.id}>
                  <Td>
                    <Link href={`/dashboard/units/${unit.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                      {unit.name}
                    </Link>
                  </Td>
                  <Td className="text-slate-400">
                    {unit.region_city ?? '—'}
                    {unit.region_state ? `, ${unit.region_state}` : ''}
                  </Td>
                  <Td className="text-slate-400">{unit.whatsapp_phone ?? '—'}</Td>
                  <Td>
                    <Badge variant={unit.is_active ? 'green' : 'slate'}>{unit.is_active ? 'Ativa' : 'Inativa'}</Badge>
                  </Td>
                  <Td>
                    <CopyWhatsAppLink unitId={unit.id} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  )
}
