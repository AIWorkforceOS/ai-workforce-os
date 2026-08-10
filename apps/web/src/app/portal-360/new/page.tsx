import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { NewOrderForm } from '@/components/portal-360/new-order-form'

export default async function Portal360NewOrderPage() {
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) {
    redirect('/portal-360')
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/portal-360" className="flex w-fit items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white">
        <ChevronLeft size={14} />
        Back to orders
      </Link>
      <PageHeader
        eyebrow="New service order"
        title="Attach an order"
        subtitle="Upload the order and choose the day you'd like it handled. Mawi assigns the technician and exact time."
      />
      <NewOrderForm />
    </div>
  )
}
