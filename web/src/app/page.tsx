import { Milestone1FoundationPanel } from "@/components/milestone1-foundation-panel";
import { Milestone2AnalysisPanel } from "@/components/milestone2-analysis-panel";
import { Milestone3HistoryPanel } from "@/components/milestone3-history-panel";
import { Milestone4GrowthPanel } from "@/components/milestone4-growth-panel";
import { Milestone5HardeningPanel } from "@/components/milestone5-hardening-panel";
import { Milestone6OpsPanel } from "@/components/milestone6-ops-panel";
import { Milestone7OpsGovernancePanel } from "@/components/milestone7-ops-governance-panel";

const academySections = [
  {
    title: "1) Rubrica tunsori dama",
    items: [
      "Tunsori scurte dama: pixie clasic, pixie texturat, bixie, crop feminin.",
      "Tunsori medii: bob clasic, bob drept, bob asimetric, long bob, french bob.",
      "Tunsori moderne: wolf cut, butterfly cut, shag modern, mixuri stratificate.",
      "Tunsori par lung: straturi lungi, U shape, V shape, framing fata."
    ]
  },
  {
    title: "2) Rubrica tunsori barbatesti",
    items: [
      "Toate tipurile de fade: low, mid, high, skin, drop, burst, taper.",
      "Modele clasice: crew cut, buzz cut, side part, pompadour, quiff.",
      "Modele moderne: crop texturat, french crop, mullet modern, faux hawk."
    ]
  },
  {
    title: "3) Rubrica colorare (vopsit)",
    items: [
      "Vopsit total, vopsit radacina, refresh lungimi, analiza culorii.",
      "Tehnici avansate: balayage, folii/suvite, babylights, root shadow, color melt.",
      "Par blond: vopsit blond, tonare blond, corectare galben/portocaliu."
    ]
  },
  {
    title: "4) Rubrica decolorarea parului",
    items: [
      "Cand facem decolorare si cand evitam, in functie de fir/scalp.",
      "Pentru ce culori este necesara decolorarea si pentru ce nu.",
      "Analiza firului: test suvita, porozitate, grosime, rezistenta la intindere."
    ]
  },
  {
    title: "5) Rubrica coafuri",
    items: [
      "Coafuri de ocazie/seara: coc elegant, hollywood waves, pony glam.",
      "Coafuri de zi cu zi: brushing natural, beach waves, half-up simplu."
    ]
  },
  {
    title: "6) Rubrica extensii de par",
    items: [
      "Tipuri: clip-in, tape-in, keratina, micro-ring, weft/cusut.",
      "Matching culoare, mentenanta, protectie termica, intervale de intretinere."
    ]
  },
  {
    title: "7) Rubrica tratamente hidratare",
    items: [
      "Cu clatire: masca hidratanta, balsam intensiv.",
      "Fara clatire: leave-in cream, spray hidratant, serum varfuri.",
      "Plan hidratare pe 4-8 saptamani, cu reevaluare."
    ]
  },
  {
    title: "8) Rubrica tratamente cu keratina",
    items: [
      "Cand se recomanda si cand se evita.",
      "Protocol: analiza firului, test suvita, sigilare termica, mentenanta post-tratament.",
      "Intretinere: sampon fara sulfati si protectie termica."
    ]
  },
  {
    title: "9) Rubrica spalare par, tipuri de par si sampoane",
    items: [
      "Tipuri de par: normal, uscat, gras, mixt, sensibil, vopsit/decolorat.",
      "Sampoane recomandate pe nevoie: hidratare, volum, protectie culoare, detox.",
      "Tehnica corecta: dublu sampon bland, masaj scalp, clatire completa."
    ]
  },
  {
    title: "10) Produse dupa spalare + uscare si aranjare",
    items: [
      "Produse post-spalare: protectie termica, crema styling, mousse, ulei usor.",
      "Cum usuci si aranjezi: sectiuni clare, flux corect, temperatura potrivita."
    ]
  }
];

export default function Home() {
  return (
    <div className="app-shell-next">
      <header className="topbar-next">
        <div>
          <p className="eyebrow-next">Asistent AI pentru hairstyling profesional</p>
          <h1>AI Hair Architect</h1>
          <span className="preview-pill-next">Etapa Next.js + TypeScript</span>
        </div>
        <nav className="nav-next" aria-label="navigation">
          <a href="#home">Acasa</a>
          <a href="/preview">Try Free Preview</a>
          <a href="#milestone1">M1 Foundation</a>
          <a href="#milestone2">M2 Analysis</a>
          <a href="#milestone3">M3 History</a>
          <a href="#milestone4">M4 Growth</a>
          <a href="#milestone5">M5 Scale</a>
          <a href="#milestone6">M6 Ops</a>
          <a href="#milestone7">M7 Governance</a>
          <a href="#analysis">Analiza</a>
          <a href="#academy">Academie</a>
        </nav>
      </header>

      <Milestone1FoundationPanel />
      <Milestone2AnalysisPanel />
      <Milestone3HistoryPanel />
      <Milestone4GrowthPanel />
      <Milestone5HardeningPanel />
      <Milestone6OpsPanel />
      <Milestone7OpsGovernancePanel />

      <section className="hero-next" id="home">
        <div>
          <h2>Baza noua este live in Next.js</h2>
          <p>
            Am pornit migrarea intr-o arhitectura moderna. Urmatorii pasi sunt
            sa mutam gradual datele, autentificarea si tutorialele in formatul
            pe care il doresti.
          </p>
        </div>
        <div className="status-card-next">
          <h3>Status etapa 1</h3>
          <ul>
            <li>Next.js + TypeScript configurat</li>
            <li>Structura principala migrata</li>
            <li>Academie organizata pe rubrici</li>
          </ul>
        </div>
      </section>

      <section className="section-next" id="analysis">
        <h3>Analiza rapida par</h3>
        <div className="analysis-grid-next">
          <label>
            Tipul parului
            <select defaultValue="coarse">
              <option value="coarse">Par gros</option>
              <option value="medium">Par normal</option>
              <option value="fine">Par subtire</option>
            </select>
          </label>
          <label>
            Densitate
            <select defaultValue="low">
              <option value="low">Par rar</option>
              <option value="medium">Par normal</option>
              <option value="high">Par des</option>
            </select>
          </label>
          <label>
            Porozitate
            <select defaultValue="high">
              <option value="high">Par aspru / poros</option>
              <option value="low">Par fin</option>
              <option value="medium">Par normal</option>
            </select>
          </label>
        </div>
      </section>

      <section className="section-next" id="academy">
        <div className="section-header-next">
          <h3>Biblioteca profesionala</h3>
          <span>Structura salon</span>
        </div>
        <div className="academy-grid-next">
          {academySections.map((section) => (
            <article key={section.title} className="academy-card-next">
              <h4>{section.title}</h4>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
