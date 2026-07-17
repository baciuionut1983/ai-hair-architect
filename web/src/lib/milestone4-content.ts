import { randomUUID } from "crypto";

import type {
  AcademyCategory,
  AcademyLesson,
  AnalysisGoal,
  Locale,
  ProductRecord,
  ShortlistRecord,
  SupplierRecord,
  VideoLessonRecord
} from "@/lib/contracts";
import { sanitize, store } from "@/lib/milestone1-store";

const seedCategories: AcademyCategory[] = [
  {
    id: "cat-haircuts",
    key: "haircuts",
    name: "Haircuts",
    description: "Women and men cuts, layering, precision and shape control."
  },
  {
    id: "cat-color",
    key: "color",
    name: "Color",
    description: "Gloss, permanent and correction workflows."
  },
  {
    id: "cat-lightening",
    key: "lightening",
    name: "Lightening",
    description: "Lift levels, foils, safety and toning paths."
  },
  {
    id: "cat-styling",
    key: "styling",
    name: "Styling",
    description: "Daily and event styling patterns."
  },
  {
    id: "cat-extensions",
    key: "extensions",
    name: "Extensions",
    description: "Selection and maintenance of extension systems."
  },
  {
    id: "cat-treatments",
    key: "treatments",
    name: "Treatments",
    description: "Hydration, repair and scalp-care protocols."
  },
  {
    id: "cat-keratin",
    key: "keratin",
    name: "Keratin",
    description: "Indications, contraindications and aftercare."
  },
  {
    id: "cat-washing",
    key: "washing",
    name: "Washing",
    description: "Scalp types, cleansing and post-wash behavior."
  },
  {
    id: "cat-products",
    key: "products",
    name: "Products",
    description: "Product stack by goals and service context."
  }
];

const seedLessons: AcademyLesson[] = [
  {
    id: "lesson-color-correction-01",
    categoryId: "cat-color",
    title: "Color Correction Triage",
    summary: "How to classify banding, warmth and uneven lift before intervention.",
    warnings: ["Always run strand test", "Escalate if structural damage is visible"]
  },
  {
    id: "lesson-lightening-01",
    categoryId: "cat-lightening",
    title: "Safe Lift Planning",
    summary: "Choose lift target based on porosity, density and previous history.",
    warnings: ["Do not overlap bleach", "Patch test when scalp sensitivity is unknown"]
  },
  {
    id: "lesson-treatments-01",
    categoryId: "cat-treatments",
    title: "Hydration and Bonding Cycle",
    summary: "4-week sequence for high-porosity post-color hair.",
    warnings: ["Avoid over-proteinization"]
  },
  {
    id: "lesson-styling-01",
    categoryId: "cat-styling",
    title: "Heat Control Fundamentals",
    summary: "Tool temperature bands and heat protect strategy by hair type.",
    warnings: ["Do not exceed safe heat on compromised hair"]
  }
];

const seedProducts: ProductRecord[] = [
  {
    id: "prod-repair-mask-1",
    name: "Repair Mask Pro",
    category: "treatments",
    countryCodes: ["RO", "GB", "US"],
    cityAvailability: ["Bucharest", "Cluj", "London", "New York"],
    goals: ["treat", "refresh"],
    brand: "AHA Lab"
  },
  {
    id: "prod-gloss-kit-1",
    name: "Gloss Kit Neutral",
    category: "color",
    countryCodes: ["RO", "DE", "FR"],
    cityAvailability: ["Bucharest", "Berlin", "Paris"],
    goals: ["refresh", "cover"],
    brand: "Chromatic"
  },
  {
    id: "prod-lift-powder-1",
    name: "Lift Powder 9",
    category: "lightening",
    countryCodes: ["RO", "IT", "ES"],
    cityAvailability: ["Bucharest", "Milan", "Madrid"],
    goals: ["lighten", "correct"],
    brand: "LevelUp"
  }
];

const seedSuppliers: SupplierRecord[] = [
  {
    id: "sup-ro-buc-1",
    name: "Salon Supply Bucuresti",
    countryCode: "RO",
    city: "Bucharest",
    categories: ["color", "treatments", "lightening"],
    supportedGoals: ["refresh", "cover", "lighten", "treat"],
    rating: 4.7
  },
  {
    id: "sup-ro-clj-1",
    name: "Transylvania Hair Trade",
    countryCode: "RO",
    city: "Cluj",
    categories: ["treatments", "extensions"],
    supportedGoals: ["treat", "reshape"],
    rating: 4.5
  },
  {
    id: "sup-gb-ldn-1",
    name: "London Pro Hair Depot",
    countryCode: "GB",
    city: "London",
    categories: ["color", "styling", "products"],
    supportedGoals: ["refresh", "cover", "correct"],
    rating: 4.6
  }
];

let initialized = false;

export function ensureMilestone4SeedData() {
  if (initialized) {
    return;
  }

  if (store.academyCategories.length === 0) {
    store.academyCategories.push(...seedCategories);
  }
  if (store.academyLessons.length === 0) {
    store.academyLessons.push(...seedLessons);
  }
  if (store.products.length === 0) {
    store.products.push(...seedProducts);
  }
  if (store.suppliers.length === 0) {
    store.suppliers.push(...seedSuppliers);
  }

  initialized = true;
}

export function listAcademyCategories(): AcademyCategory[] {
  ensureMilestone4SeedData();
  return [...store.academyCategories];
}

export function listAcademyLessons(categoryId?: string): AcademyLesson[] {
  ensureMilestone4SeedData();
  const normalizedCategoryId = sanitize(categoryId);
  return store.academyLessons.filter((lesson) => {
    return !normalizedCategoryId || lesson.categoryId === normalizedCategoryId;
  });
}

export function getAcademyLessonById(lessonId: string): AcademyLesson | null {
  ensureMilestone4SeedData();
  const normalizedId = sanitize(lessonId);
  return store.academyLessons.find((lesson) => lesson.id === normalizedId) ?? null;
}

function recommendLessons(topic: string): string[] {
  const normalized = topic.toLowerCase();
  const lessons = listAcademyLessons();
  const directMatches = lessons.filter((lesson) => {
    return (
      lesson.title.toLowerCase().includes(normalized) ||
      lesson.summary.toLowerCase().includes(normalized)
    );
  });

  if (directMatches.length > 0) {
    return directMatches.slice(0, 3).map((lesson) => lesson.id);
  }

  return lessons.slice(0, 2).map((lesson) => lesson.id);
}

export function generateVideoLesson(input: {
  ownerUserId: string;
  topic: string;
  level: "beginner" | "intermediate" | "advanced";
  locale: Locale;
}): VideoLessonRecord {
  ensureMilestone4SeedData();

  const topic = sanitize(input.topic);
  const recommendations = recommendLessons(topic);

  const script = [
    `Topic: ${topic}`,
    `Level: ${input.level}`,
    "Step 1: Analyze baseline and desired outcome.",
    "Step 2: Explain tools, products, and safety constraints.",
    "Step 3: Demonstrate execution path and checkpoints.",
    "Step 4: Provide aftercare and follow-up plan."
  ].join("\n");

  const record: VideoLessonRecord = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    topic,
    level: input.level,
    locale: input.locale,
    status: "completed",
    recommendedLessonIds: recommendations,
    script,
    videoUrl: `https://videos.ai-hair-architect.local/${encodeURIComponent(topic)}.mp4`,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };

  store.videoLessons.push(record);
  return record;
}

export function getVideoLessonById(videoLessonId: string, ownerUserId: string): VideoLessonRecord | null {
  const normalizedId = sanitize(videoLessonId);
  return (
    store.videoLessons.find((entry) => entry.id === normalizedId && entry.ownerUserId === ownerUserId) ?? null
  );
}

export function listProducts(filter?: { countryCode?: string; city?: string; goal?: AnalysisGoal }) {
  ensureMilestone4SeedData();
  const countryCode = sanitize(filter?.countryCode).toUpperCase();
  const city = sanitize(filter?.city).toLowerCase();
  const goal = filter?.goal;

  return store.products.filter((item) => {
    const countryOk = !countryCode || item.countryCodes.includes(countryCode);
    const cityOk = !city || item.cityAvailability.some((entry) => entry.toLowerCase() === city);
    const goalOk = !goal || item.goals.includes(goal);
    return countryOk && cityOk && goalOk;
  });
}

export function listSuppliers(filter?: { countryCode?: string; city?: string; goal?: AnalysisGoal }) {
  ensureMilestone4SeedData();
  const countryCode = sanitize(filter?.countryCode).toUpperCase();
  const city = sanitize(filter?.city).toLowerCase();
  const goal = filter?.goal;

  return store.suppliers.filter((item) => {
    const countryOk = !countryCode || item.countryCode === countryCode;
    const cityOk = !city || item.city.toLowerCase() === city;
    const goalOk = !goal || item.supportedGoals.includes(goal);
    return countryOk && cityOk && goalOk;
  });
}

export function listRecommendedSuppliers(filter?: {
  countryCode?: string;
  city?: string;
  goal?: AnalysisGoal;
  category?: string;
}) {
  const category = sanitize(filter?.category).toLowerCase();

  return listSuppliers(filter)
    .filter((supplier) => {
      return !category || supplier.categories.some((item) => item.toLowerCase() === category);
    })
    .sort((left, right) => right.rating - left.rating);
}

export function createShortlist(input: {
  ownerUserId: string;
  clientId: string;
  title: string;
  productIds: string[];
  supplierIds: string[];
}): ShortlistRecord {
  const record: ShortlistRecord = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    clientId: sanitize(input.clientId),
    title: sanitize(input.title),
    productIds: input.productIds,
    supplierIds: input.supplierIds,
    createdAt: new Date().toISOString()
  };

  store.shortlists.push(record);
  return record;
}

export function listShortlistsForUser(ownerUserId: string): ShortlistRecord[] {
  return store.shortlists
    .filter((entry) => entry.ownerUserId === ownerUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
