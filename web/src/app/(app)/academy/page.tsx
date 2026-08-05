import { GraduationCap } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function AcademyPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Academy</h1>
      <EmptyState
        icon={GraduationCap}
        title="The professional library is coming soon"
        description="Browsing lessons and topics is being rebuilt as its own dedicated screen. This section is not available yet."
      />
    </div>
  );
}
