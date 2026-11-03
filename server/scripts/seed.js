// Loads the starting catalogue: categories, two collections, sixteen perfumes and the guide.
// Runs on every deploy (scripts/setup.js) and from `npm run seed`. It is resumable and runs once:
//   - each category, collection and perfume is added only if missing, so an interrupted run finishes later;
//   - when everything is in, a marker is saved, and later runs never re-add perfumes the shop deleted.
//
// The perfumes are an illustrative starting point so the shop is complete on day one. Names,
// notes and prices (in CFA francs) are examples for the team to replace or confirm in the admin;
// the dashboard reminds them until they do. No photo is needed: the shop draws each bottle.
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createRepositories } from '../src/repositories/index.js';
import { slugify } from '../src/lib/form.js';

const DONE_MARKER = 'starter-catalogue';
const CFA = (amount) => amount * 100; // stored in "cents", like every currency

const CATEGORIES = ['Pour elle', 'Pour lui', 'Mixte', 'Huiles précieuses', 'Coffrets'];
const COLLECTIONS = [
  { name: 'Les Ors', slug: 'les-ors', description: 'Les signatures de la maison, nées de la ligne de lumière.' },
  { name: 'Nuits d’Orient', slug: 'nuits-d-orient', description: 'Ouds, ambres et résines pour les soirs qui comptent.' },
];
const STANDARD_SIZES = (s30, s50, s100) => [['30 ml', s30], ['50 ml', s50], ['100 ml', s100]];

const PERFUMES = [
  { name: 'Or Sillage', category: 'Mixte', audience: 'unisex', family: 'amber', concentration: 'edp', intensity: 4, moment: 'night',
    top: 'Safran, Bergamote', heart: 'Rose de Taïf, Ambre', base: 'Vanille de Madagascar, Benjoin, Musc', hue: 30,
    tagline: 'La ligne d’or, portée sur la peau.', badge: 'Best-seller', collections: ['les-ors'],
    description: 'Le parfum signature de la maison. Un ambre lumineux où le safran s’embrase sur une rose veloutée, puis se pose sur une vanille résineuse qui tient jusqu’au lendemain.',
    sizes: STANDARD_SIZES(25000, 38000, 58000) },
  { name: 'Nuit Cuivrée', category: 'Pour lui', audience: 'men', family: 'leather', concentration: 'extrait', intensity: 5, moment: 'night',
    top: 'Safran, Cuir', heart: 'Oud, Tabac blond', base: 'Labdanum, Bouleau fumé', hue: 14,
    tagline: 'Un cuir fumé, une présence magnétique.', badge: 'Signature', collections: ['les-ors', 'nuits-d-orient'],
    description: 'Un extrait dense et sombre : le cuir rencontre l’oud et le tabac blond, adouci par le labdanum. Pour les soirées où l’on ne passe pas inaperçu.',
    sizes: [['50 ml', 52000], ['100 ml', 78000]] },
  { name: 'Rose Lumière', category: 'Pour elle', audience: 'women', family: 'floral', concentration: 'edp', intensity: 3, moment: 'day',
    top: 'Litchi, Poire', heart: 'Rose de Mai, Pivoine', base: 'Musc blanc, Cèdre', hue: 345, isNew: true,
    tagline: 'Une rose cueillie au lever du jour.', collections: ['les-ors'],
    description: 'Une rose fraîche et juteuse, éclairée de litchi et de poire, qui laisse sur la peau un sillage de musc propre et de bois clair.',
    sizes: STANDARD_SIZES(22000, 34000, 52000) },
  { name: 'Velours d’Ambre', category: 'Pour elle', audience: 'women', family: 'gourmand', concentration: 'edp', intensity: 4, moment: 'night',
    top: 'Mandarine', heart: 'Praliné, Fleur d’oranger', base: 'Vanille, Fève tonka, Caramel', hue: 32, badge: 'Best-seller',
    tagline: 'Une douceur dorée qui se respire de près.',
    description: 'Un gourmand chaleureux et enveloppant : praliné, fleur d’oranger et vanille fondent sur une fève tonka caramélisée.',
    sizes: STANDARD_SIZES(24000, 36000, 55000) },
  { name: 'Brise de Lagune', category: 'Pour lui', audience: 'men', family: 'fresh', concentration: 'edt', intensity: 2, moment: 'day',
    top: 'Citron vert, Notes marines', heart: 'Lavande, Sauge', base: 'Ambroxan, Vétiver', hue: 192,
    tagline: 'Le souffle salé de la lagune au matin.',
    description: 'Une fraîcheur aquatique et aromatique, nette et lumineuse, idéale sous la chaleur et pour le bureau.',
    sizes: STANDARD_SIZES(18000, 27000, 42000) },
  { name: 'Néroli Solaire', category: 'Mixte', audience: 'unisex', family: 'citrus', concentration: 'edc', intensity: 2, moment: 'day',
    top: 'Bergamote, Néroli, Petitgrain', heart: 'Fleur d’oranger', base: 'Musc blanc', hue: 46, isNew: true,
    tagline: 'Une cologne qui sent le soleil sur la peau.',
    description: 'Un hespéridé pétillant et solaire. À vaporiser sans compter, à tout moment de la journée.',
    sizes: [['100 ml', 26000], ['200 ml', 42000]] },
  { name: 'Oud Impérial', category: 'Mixte', audience: 'unisex', family: 'woody', concentration: 'extrait', intensity: 5, moment: 'night',
    top: 'Rose, Safran', heart: 'Oud, Encens', base: 'Patchouli, Ambre gris', hue: 22, badge: 'Édition limitée',
    availability: 'low_stock', collections: ['nuits-d-orient'],
    tagline: 'L’oud dans toute sa noblesse.',
    description: 'Un oud profond et précieux, auréolé de rose et d’encens, qui révèle peu à peu un fond d’ambre gris. Une édition limitée.',
    sizes: [['50 ml', 65000], ['100 ml', 95000]] },
  { name: 'Terre d’Argile', category: 'Mixte', audience: 'unisex', family: 'woody', concentration: 'edp', intensity: 3, moment: 'any',
    top: 'Cardamome, Poivre rose', heart: 'Cèdre de l’Atlas, Iris', base: 'Vétiver, Santal, Ambrette', hue: 18, collections: ['les-ors'],
    tagline: 'Un mur d’argile chauffé par le soleil.',
    description: 'Un boisé minéral et poudré, épicé de cardamome, à porter comme une seconde peau.',
    sizes: STANDARD_SIZES(23000, 35000, 54000) },
  { name: 'Jasmin Nocturne', category: 'Pour elle', audience: 'women', family: 'floral', concentration: 'extrait', intensity: 4, moment: 'night',
    top: 'Poivre noir', heart: 'Jasmin sambac, Tubéreuse', base: 'Santal, Benjoin', hue: 50,
    tagline: 'Les fleurs blanches à la tombée de la nuit.',
    description: 'Un bouquet capiteux de fleurs blanches relevé de poivre noir, posé sur un santal crémeux.',
    sizes: [['50 ml', 45000], ['100 ml', 68000]] },
  { name: 'Musc Céleste', category: 'Pour elle', audience: 'women', family: 'musky', concentration: 'edp', intensity: 2, moment: 'any',
    top: 'Aldéhydes, Poire', heart: 'Iris, Fleur de coton', base: 'Musc blanc, Ambrette', hue: 36,
    tagline: 'L’odeur d’une peau propre et douce.',
    description: 'Un musc poudré et lumineux, intime, qui se fond dans la peau et se redécouvre au fil des heures.',
    sizes: STANDARD_SIZES(20000, 30000, 46000) },
  { name: 'Vétiver Noble', category: 'Pour lui', audience: 'men', family: 'aromatic', concentration: 'edp', intensity: 3, moment: 'day',
    top: 'Pamplemousse, Menthe', heart: 'Géranium, Lavande', base: 'Vétiver, Cèdre', hue: 88,
    tagline: 'L’élégance d’une chemise blanche.',
    description: 'Un aromatique vert et racé, construit autour d’un vétiver fumé et de lavande fraîche.',
    sizes: STANDARD_SIZES(21000, 32000, 49000) },
  { name: 'Cèdre Sacré', category: 'Pour lui', audience: 'men', family: 'chypre', concentration: 'edp', intensity: 4, moment: 'night',
    top: 'Bergamote', heart: 'Patchouli, Mousse de chêne', base: 'Cuir, Cèdre', hue: 75,
    tagline: 'Un chypré d’autrefois, réinventé.',
    description: 'La fraîcheur de la bergamote sur un cœur de patchouli et de mousse de chêne, puis un fond cuiré et boisé.',
    sizes: STANDARD_SIZES(23000, 35000, 53000) },
  { name: 'Huile d’Or', category: 'Huiles précieuses', audience: 'unisex', family: 'amber', concentration: 'oil', intensity: 3, moment: 'any',
    top: 'Safran', heart: 'Rose, Ambre', base: 'Musc, Santal', hue: 36, collections: ['nuits-d-orient'],
    tagline: 'Quelques gouttes, toute une journée.',
    description: 'Une huile de parfum sans alcool, à appliquer sur les points de pulsation. Elle se pose seule ou sous un parfum.',
    sizes: [['12 ml', 15000], ['30 ml', 32000]] },
  { name: 'Huile Musc Blanc', category: 'Huiles précieuses', audience: 'unisex', family: 'musky', concentration: 'oil', intensity: 2, moment: 'any',
    top: 'Fleur de coton', heart: 'Musc blanc', base: 'Ambrette, Bois de cachemire', hue: 40,
    tagline: 'Un voile de douceur, au plus près de la peau.',
    description: 'L’essentiel du musc blanc en huile pure, pour parfumer la peau et les cheveux avec délicatesse.',
    sizes: [['12 ml', 12000], ['30 ml', 26000]] },
  { name: 'Brume Dorée', category: 'Pour elle', audience: 'women', family: 'gourmand', concentration: 'mist', intensity: 2, moment: 'day',
    top: 'Mandarine, Noix de coco', heart: 'Fleur de frangipanier', base: 'Vanille', hue: 40, isNew: true,
    tagline: 'Pour les cheveux et le corps.',
    description: 'Une brume légère et ensoleillée à vaporiser sur les cheveux et le corps, à réappliquer à volonté.',
    sizes: [['100 ml', 14000]] },
  { name: 'Coffret Découverte', category: 'Coffrets', audience: 'unisex', family: 'amber', concentration: 'edp', intensity: 3, moment: 'any',
    top: 'Safran, Bergamote, Litchi', heart: 'Rose, Oud, Praliné', base: 'Vanille, Santal, Musc', hue: 28, badge: 'Idée cadeau',
    tagline: 'Cinq miniatures pour trouver votre signature.',
    description: 'Cinq eaux de parfum de 5 ml dans un écrin cuivré : Or Sillage, Nuit Cuivrée, Rose Lumière, Velours d’Ambre et Terre d’Argile.',
    price: 20000, sizes: [] },
];

// From the questions customers ask most often in a perfume shop. Every answer can be edited in the admin.
const GUIDE = [
  ['Comment commander ?',
    'Ajoutez vos parfums à votre sélection puis cliquez sur « Commander sur WhatsApp ».\nIndiquez votre nom et votre adresse : WhatsApp s’ouvre avec votre commande déjà rédigée. Il ne reste qu’à l’envoyer.\nUne conseillère vous répond pour confirmer le jour et l’heure de livraison.'],
  ['Comment se passe la livraison ?',
    'Nous livrons à Abidjan sous 24 h et dans toute la Côte d’Ivoire sous 48 à 72 h.\nLe montant de la livraison vous est indiqué avant de confirmer.'],
  ['Comment payer ?', 'Vous payez à la livraison, en espèces ou par Mobile Money. Aucun paiement n’est demandé sur le site.'],
  ['Vos parfums sont-ils authentiques ?', 'Oui. Chaque flacon est authentique, scellé et conservé à l’abri de la lumière et de la chaleur jusqu’à votre porte.'],
  ['Comment faire tenir mon parfum plus longtemps ?',
    'Vaporisez-le sur une peau hydratée, sur les points de pulsation : poignets, cou, creux des coudes.\nNe frottez pas : cela casse les notes de tête.\nUne huile de parfum sous votre eau de parfum prolonge le sillage de plusieurs heures.'],
  ['Comment conserver mon parfum ?', 'Gardez-le dans sa boîte, à l’abri de la lumière, de la chaleur et de l’humidité. Évitez la salle de bain et la voiture.'],
  ['Puis-je échanger un parfum ?', 'Pour des raisons d’hygiène, un parfum ouvert ne peut être ni repris ni échangé. Un flacon encore scellé peut être échangé sous 7 jours.'],
];

async function ensureTaxonomy(repos) {
  const categoryIds = {};
  for (const name of CATEGORIES) {
    const slug = slugify(name);
    categoryIds[name] = (await repos.categories.findBySlug(slug))?.id ?? await repos.categories.create({ name, slug });
  }
  const collectionIds = {};
  for (const { name, slug, description } of COLLECTIONS) {
    collectionIds[slug] = (await repos.collections.findBySlug(slug))?.id
      ?? await repos.collections.create({ name, slug, description, isVisible: true });
  }
  return { categoryIds, collectionIds };
}

function toPerfumeInput(perfume, { categoryIds, collectionIds }) {
  return {
    name: perfume.name, house: '', categoryId: categoryIds[perfume.category], audience: perfume.audience,
    family: perfume.family, concentration: perfume.concentration, intensity: perfume.intensity, moment: perfume.moment,
    notesTop: perfume.top, notesHeart: perfume.heart, notesBase: perfume.base, tagline: perfume.tagline ?? '',
    badge: perfume.badge ?? '', isNew: perfume.isNew ?? false, description: perfume.description,
    priceCents: perfume.price ? CFA(perfume.price) : null, compareAtCents: null, status: 'published',
    availability: perfume.availability ?? 'in_stock', hue: perfume.hue, instagramUrl: '',
    sizes: perfume.sizes.map(([label, price]) => ({ label, priceCents: CFA(price) })),
    collectionIds: (perfume.collections ?? []).map((slug) => collectionIds[slug]),
  };
}

export async function seedCatalogue({ repos, log = console.log }) {
  if (await repos.settings.getMarker(DONE_MARKER)) return false;
  const taxonomy = await ensureTaxonomy(repos);
  let added = 0;
  for (const perfume of PERFUMES) {
    if (await repos.perfumes.findBySlug(slugify(perfume.name))) continue;
    await repos.perfumes.create(toPerfumeInput(perfume, taxonomy));
    added += 1;
  }
  if (!(await repos.guide.list()).length) {
    for (const [question, answer] of GUIDE) await repos.guide.create({ question, answer, isVisible: true });
    log(`Added ${GUIDE.length} guide questions`);
  }
  await repos.settings.setMarker(DONE_MARKER, new Date().toISOString());
  await repos.activity.log(null, 'seed', 'loaded the starter catalogue');
  log(`Starter catalogue ready (${added} perfumes added in this run).`);
  return true;
}

// Run directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await openDatabase({ url: config.databaseUrl, authToken: config.databaseToken });
  const repos = createRepositories(db);
  const seeded = await seedCatalogue({ repos });
  if (!seeded) console.log('Nothing was changed.');
  db.close();
}
