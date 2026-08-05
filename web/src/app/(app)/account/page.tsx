import { CircleUserRound } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Account & Subscription</h1>
      <EmptyState
        icon={CircleUserRound}
        title="Account and billing management are coming soon"
        description="Viewing your plan and managing checkout are being rebuilt as their own dedicated screen. This section is not available yet."
      />
    </div>
  );
}
