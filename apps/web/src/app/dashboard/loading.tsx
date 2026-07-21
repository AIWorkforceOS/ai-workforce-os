import { KpiCardSkeleton, PageHeaderSkeleton, TableCardSkeleton } from '@/components/ui/dashboard-ui'

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
      <TableCardSkeleton />
    </div>
  )
}
