import { Users } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function ClientsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Clients</h1>
      <EmptyState
        icon={Users}
        title="Client management is coming soon"
        description="A full client list, profiles, and history are being rebuilt as their own dedicated screens. This section is not available yet."
      />
    </div>
  );
}
