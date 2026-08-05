import { ShoppingBag } from "lucide-react";

import { EmptyState } from "@/components/ui";

export default function MarketplacePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Marketplace</h1>
      <EmptyState
        icon={ShoppingBag}
        title="Products and suppliers are coming soon"
        description="Browsing recommended products and local suppliers is being rebuilt as its own dedicated screen. This section is not available yet."
      />
    </div>
  );
}
