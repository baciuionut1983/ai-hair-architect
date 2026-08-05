import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function AppointmentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Appointments</h1>
      <EmptyState
        icon={CalendarDays}
        title="A dedicated calendar view is coming soon"
        description="Scheduling and reminders are being rebuilt as their own dedicated screen. This section is not available yet."
      />
    </div>
  );
}
