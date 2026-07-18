// Types for the custom card/set authoring system (synced to Forge).

export interface CustomSet {
  id: string;
  code: string; // Forge edition code, e.g. "WOT"
  name: string;
  releaseDate: string; // YYYY-MM-DD
  ownerId: string | null;
  cardCount?: number;
}

export interface CustomCard {
  id: string;
  setId: string;
  name: string;
  manaCost: string | null; // Forge form: "1 R"
  types: string; // "Creature Goblin"
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  keywords: string[];
  oracle: string;
  flavor: string | null;
  rarity: string; // C U R M S L
  artist: string | null;
  collectorNumber: number | null;
  artPath: string | null; // has generated/uploaded art?
  forgeScript: string;
  advanced: boolean;
  frameTheme: string; // id from FRAME_THEMES; the compositor's card-face look
  isToken: boolean; // a printable token entry — not a real deck card
}

// Selectable card-face looks for the frame compositor, each modeled on a real
// Magic set/treatment. The ids are stored on the card; the server compositor
// (server/src/custom/frame.ts) holds the actual palettes/layouts keyed by id.
export interface FrameTheme {
  id: string;
  label: string;
  inspiredBy: string; // the real card/set the look is drawn from
}

export const FRAME_THEMES: FrameTheme[] = [
  { id: "classic", label: "Classic (M15)", inspiredBy: "modern core-set cards" },
  { id: "retro", label: "Retro '93", inspiredBy: "Alpha / Beta beige border" },
  { id: "borderless", label: "Full-art showcase", inspiredBy: "borderless mythics (art behind translucent text)" },
  { id: "zendikar", label: "Zendikar full-art", inspiredBy: "Zendikar full-art lands" },
  { id: "innistrad", label: "Innistrad gothic", inspiredBy: "Innistrad horror frame" },
  { id: "theros", label: "Theros constellation", inspiredBy: "Theros starfield" },
  { id: "kaldheim", label: "Kaldheim snow", inspiredBy: "Kaldheim snow-covered" },
  { id: "amonkhet", label: "Amonkhet desert", inspiredBy: "Amonkhet sandstone" },
  { id: "neon", label: "Kamigawa neon", inspiredBy: "Neon Dynasty showcase" },
  { id: "dominaria", label: "Dominaria parchment", inspiredBy: "Dominaria legendary frame" },
  { id: "phyrexian", label: "Phyrexian", inspiredBy: "New Phyrexia oily black" },
  { id: "storybook", label: "Storybook", inspiredBy: "Eldraine adventure / kid-friendly" },
];

export const RARITIES = [
  { code: "C", label: "Common" },
  { code: "U", label: "Uncommon" },
  { code: "R", label: "Rare" },
  { code: "M", label: "Mythic" },
  { code: "S", label: "Special" },
  { code: "L", label: "Land / Basic" },
] as const;

// Card types the guided form offers; the details form adapts to the choice.
export const CARD_TYPES = ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land", "Battle"] as const;

// Art-style presets shown in the art step (label + prompt fragment + an example
// real card so the user can see the look).
export interface ArtStyle {
  id: string;
  label: string;
  promptStyle: string; // appended to the image prompt
  exampleCard: string; // a real card name whose art shows the style
}

export const ART_STYLES: ArtStyle[] = [
  { id: "modern", label: "Modern (M15)", promptStyle: "modern Magic: The Gathering card art, painterly digital illustration, dramatic lighting, cinematic composition", exampleCard: "Snapcaster Mage" },
  { id: "fullart", label: "Full-art", promptStyle: "full-bleed fantasy illustration with no border, sweeping vista, epic scale, edge-to-edge painting", exampleCard: "Zendikar Full-art Land" },
  { id: "vintage", label: "Vintage / retro", promptStyle: "1990s vintage Magic card art, classic oil-painting fantasy style, muted palette, traditional media look", exampleCard: "Serra Angel" },
  { id: "borderless", label: "Borderless showcase", promptStyle: "borderless showcase art, stylized modern illustration, bold silhouette, striking focal subject", exampleCard: "Ragavan, Nimble Pilferer" },
  { id: "ink", label: "Black-on-white ink", promptStyle: "black ink line art on a white background, minimalist monochrome illustration, high contrast, sketch style", exampleCard: "Nyx-Fleece Ram" },
  { id: "storybook", label: "Storybook (kid-friendly)", promptStyle: "friendly storybook illustration, soft colors, whimsical cartoon fantasy, gentle and playful", exampleCard: "Faerie Guidemother" },
];
