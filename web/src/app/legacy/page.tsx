import { Milestone1FoundationPanel } from "@/components/milestone1-foundation-panel";
import { Milestone2AnalysisPanel } from "@/components/milestone2-analysis-panel";
import { Milestone3HistoryPanel } from "@/components/milestone3-history-panel";
import { Milestone4GrowthPanel } from "@/components/milestone4-growth-panel";
import { Milestone5HardeningPanel } from "@/components/milestone5-hardening-panel";
import { Milestone6OpsPanel } from "@/components/milestone6-ops-panel";
import { Milestone7OpsGovernancePanel } from "@/components/milestone7-ops-governance-panel";

// M29 GO-4: this page is intentionally unlinked from the beta navigation.
// It is a temporary holding area for the pre-M29 milestone panels so their
// real, working functionality (client CRUD, analysis, CRM history, academy/
// marketplace browsing, billing, ops tooling) is not lost before M30-M32
// migrate each piece into its own real product screen. Do not link this
// page from anywhere a beta user can reach.
export default function LegacyPage() {
  return (
    <div className="app-shell-next">
      <header className="topbar-next">
        <div>
          <p className="eyebrow-next">Internal -- pre-M29 functionality holding area</p>
          <h1>Legacy panels</h1>
          <span className="preview-pill-next">Not linked from the product UI</span>
        </div>
      </header>

      <Milestone1FoundationPanel />
      <Milestone2AnalysisPanel />
      <Milestone3HistoryPanel />
      <Milestone4GrowthPanel />
      <Milestone5HardeningPanel />
      <Milestone6OpsPanel />
      <Milestone7OpsGovernancePanel />
    </div>
  );
}
