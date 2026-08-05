import Link from "next/link";

import { Button, Card } from "@/components/ui";

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
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 bg-background p-4 text-foreground md:p-8">
      <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-secondary">
            Asistent AI pentru hairstyling profesional
          </p>
          <h1 className="mt-1 text-2xl font-semibold md:text-3xl">AI Hair Architect</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/preview">
            <Button type="button" variant="ghost">
              Try free preview
            </Button>
          </Link>
          <Link href="/login">
            <Button type="button" variant="secondary">
              Sign in
            </Button>
          </Link>
          <Link href="/register">
            <Button type="button">Create free account</Button>
          </Link>
        </div>
      </header>

      <Card className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.3fr_0.9fr] md:p-8">
        <div>
          <h2 className="text-xl font-semibold md:text-2xl">AI-assisted consultations for hair professionals</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Analyze a client&apos;s hair, get structured cut, color, and treatment recommendations, and keep a real
            history of every service -- all in one place.
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-alt p-4">
          <h3 className="text-sm font-semibold">Getting started</h3>
          <ul className="list-inside list-disc text-sm text-muted">
            <li>Create a free account</li>
            <li>Verify your email</li>
            <li>Sign in and explore the dashboard</li>
          </ul>
        </div>
      </Card>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Biblioteca profesionala</h3>
          <span className="rounded-full bg-surface-alt px-3 py-1 text-xs text-muted">Structura salon</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {academySections.map((section) => (
            <Card key={section.title} className="bg-surface-alt">
              <h4 className="font-semibold text-foreground">{section.title}</h4>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
