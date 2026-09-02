"use client";

import { Sparkles } from "lucide-react";

import { Button, Card } from "@/components/ui";
import { useUiLanguage } from "@/lib/ui-language-context";

import { useConciergeVideoOffer } from "./use-concierge-video-offer";

export interface ConciergeVideoOfferProps {
  clientId: string;
  analysisId: string;
  // Called ONLY on an explicit "yes" click -- the parent
  // (photo-preview-history.tsx) uses this to flip
  // VideoDemonstrationSection's own requestConsentOnMount prop, opening
  // the EXISTING Video cost-consent dialog. This component itself never
  // creates a video, never calls the Video create/execute routes, and
  // never contacts Google/Veo -- see use-concierge-video-offer.ts's own
  // header comment.
  onAccept: () => void;
}

// AI Concierge / Orchestrator, Stage 2 -- the conversational offer itself
// (task section 4): "Dorești să îți generez și un video demonstrativ?"
// Renders ONLY while a real, server-verified COMPLETED Photo Preview
// produced the offer (task section 13 test A/B) -- never immediately, never
// as a modal, never auto-running anything (task section 4's own explicit
// UX rule). Disappears the instant the user answers either way (task
// section 5/13 test J: never nags again within this same mounted view).
export function ConciergeVideoOffer({ clientId, analysisId, onAccept }: ConciergeVideoOfferProps) {
  const { t } = useUiLanguage();
  const { state, accept, decline } = useConciergeVideoOffer(clientId, analysisId);

  if (state.status !== "offered") return null;

  function handleAccept() {
    accept();
    onAccept();
  }

  return (
    <Card className="flex flex-col gap-3 border-accent/30">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p className="text-sm text-foreground">{t("concierge.videoOffer.question")}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={handleAccept}>
          {t("concierge.videoOffer.yes")}
        </Button>
        <Button type="button" variant="secondary" onClick={decline}>
          {t("concierge.videoOffer.no")}
        </Button>
      </div>
    </Card>
  );
}
