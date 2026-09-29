import type { Lang } from "@/app/progress.ts";
import { EN_HUD, type HudStrings } from "@/render/scene/hud.ts";
import type { PowerupKind } from "@/sim/types.ts";

/**
 * The page's words, in English and German - all of them, the opening screen
 * included, which replaced the original's English-only INSTRUCTIONS board.
 * `m` arguments are already formatted distances ("12.34 m").
 */

export const ACHIEVEMENT_IDS = [
  "firstCheer",
  "shot25",
  "shot50",
  "shot75",
  "total150",
  "total250",
  "cheers3",
  "perfect",
  "stack2",
  "goldBall",
  "speedWind",
  "record",
  "daily",
  "streak3",
  "duelWon",
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface Strings {
  readonly hud: HudStrings;
  /** `data-i18n` keys in index.html. HTML: the help text carries `<kbd>`s. */
  readonly page: Readonly<Record<PageKey, string>>;
  readonly pause: string;
  readonly resume: string;
  readonly muteMusic: string;
  readonly unmuteMusic: string;
  readonly muteSfx: string;
  readonly unmuteSfx: string;
  readonly fullscreen: string;
  readonly exitFullscreen: string;
  readonly results: {
    readonly title: string;
    readonly newRecord: string;
    readonly dailyTitle: (day: string) => string;
    readonly duelTitle: string;
    readonly shot: (n: number) => string;
    readonly total: string;
    readonly best: string;
    readonly personalBest: (m: string) => string;
    readonly dailyBest: (m: string) => string;
    readonly streak: (days: number) => string;
    readonly duelWon: (m: string) => string;
    readonly duelLost: (m: string) => string;
    readonly duelTied: string;
    readonly playAgain: string;
    readonly rematch: string;
    readonly daily: string;
    readonly freePlay: string;
    readonly share: string;
    readonly unlocked: string;
  };
  readonly toast: {
    readonly duel: (m: string) => string;
    readonly daily: (m: string | null) => string;
    readonly badRun: string;
    readonly shotRecord: (m: string) => string;
    readonly copied: string;
    readonly shareText: (m: string) => string;
    readonly achievement: (title: string) => string;
  };
  readonly achievements: Readonly<Record<AchievementId, readonly [string, string]>>;
  readonly achievementsDone: (done: number, of: number) => string;
  readonly intro: IntroStrings;
  readonly boot: {
    readonly loading: string;
    readonly loadingPercent: (percent: number) => string;
    readonly reload: string;
    readonly noArt: string;
    readonly crashed: string;
    readonly noStart: string;
  };
}

/** How the player is playing, which decides the words for "press". */
export type InputDevice = "mouse" | "touch" | "pad";

/** One step of the how-to: a title and a line under it. */
export type Step = readonly [title: string, text: string];

export interface IntroStrings {
  readonly play: string;
  readonly playSub: string;
  readonly playDaily: string;
  readonly playDuel: string;
  readonly duelSub: (m: string) => string;
  readonly daily: string;
  readonly dailySub: (m: string | null) => string;
  readonly freePlay: string;
  readonly freeSub: string;
  readonly record: (m: string) => string;
  readonly streak: (days: number) => string;
  readonly steps: (device: InputDevice) => readonly [Step, Step, Step];
  /** The keyboard shortcuts, as `[key, what it does]`. */
  readonly keys: readonly (readonly [key: string, what: string])[];
  readonly padKeys: readonly (readonly [key: string, what: string])[];
  readonly items: Readonly<Record<PowerupKind, Step>>;
}

export type PageKey =
  | "howTo"
  | "physics"
  | "credits"
  | "rotate"
  | "settings"
  | "sfx"
  | "volume"
  | "haptics"
  | "language"
  | "langAuto"
  | "achievements"
  | "info"
  | "tagline"
  | "controlsTab"
  | "itemsTab"
  | "introSettings"
  | "music"
  | "stage"
  | "close"
  | "copyLink"
  | "itemsHint";

const EN: Strings = {
  hud: EN_HUD,
  page: {
    howTo:
      "Click or <kbd>Space</kbd> to jump, click again to hit the pillow, then hold to glide. One swing per jump; a miss costs no turn. <kbd>P</kbd>, <kbd>Esc</kbd> or the corner button pauses; a click resumes. <kbd>M</kbd> or the note mutes the music, <kbd>S</kbd> the sound effects; <kbd>F</kbd> goes full screen and <kbd>I</kbd> opens this help. A gamepad works too: <kbd>A</kbd> is the button, <kbd>Start</kbd> pauses.",
    physics: "Physics runs at a fixed 20&nbsp;Hz, as the original did.",
    credits:
      "A fan reimplementation built from bytecode analysis of the original Flash game. Not affiliated with the original publisher. Sprites are extracted from the original SWF and remain the property of their respective owners.",
    rotate: "Turn your phone sideways for a bigger stage.",
    settings: "Settings",
    sfx: "Sound effects",
    volume: "Volume",
    haptics: "Vibration",
    language: "Language",
    langAuto: "Automatic",
    achievements: "Achievements",
    info: "Help and credits",
    tagline: "Launch the hamsters - as far as they will fly.",
    controlsTab: "How to play",
    itemsTab: "Items",
    introSettings: "Sound and language",
    music: "Music",
    stage: "Game stage",
    close: "Close",
    copyLink: "Link to copy",
    itemsHint:
      "In flight, the map at the top right shows where they are - dots in these colours, faded at the edge when they are further out.",
  },
  pause: "Pause",
  resume: "Resume",
  muteMusic: "Mute music",
  unmuteMusic: "Unmute music",
  muteSfx: "Mute sound effects",
  unmuteSfx: "Unmute sound effects",
  fullscreen: "Full screen",
  exitFullscreen: "Leave full screen",
  results: {
    title: "Game over",
    newRecord: "New record!",
    dailyTitle: (day) => `Daily challenge ${day}`,
    duelTitle: "Duel",
    shot: (n) => `Hamster ${n}`,
    total: "Total",
    best: "best",
    personalBest: (m) => `Your record: ${m}`,
    dailyBest: (m) => `Today's best: ${m}`,
    streak: (days) => (days === 1 ? "1 day in a row" : `${days} days in a row`),
    duelWon: (m) => `You win by ${m}!`,
    duelLost: (m) => `The ghost wins by ${m}.`,
    duelTied: "A dead heat!",
    playAgain: "Play again",
    rematch: "Rematch",
    daily: "Daily challenge",
    freePlay: "Free play",
    share: "Challenge a friend",
    unlocked: "Unlocked this game",
  },
  toast: {
    duel: (m) => `Duel: beat the ghost's ${m}`,
    daily: (m) =>
      m === null
        ? "Daily challenge: same powerups for everyone today"
        : `Daily challenge: beat ${m}`,
    badRun: "That challenge link could not be replayed - playing a free game.",
    shotRecord: (m) => `New longest shot: ${m}`,
    copied: "Link copied - send it to someone to race your ghost",
    shareText: (m) => `I flew ${m} in HamsterFlight. Can you beat my ghost?`,
    achievement: (title) => `Achievement: ${title}`,
  },
  achievements: {
    firstCheer: ["Touchdown", "Land a shot to a cheer."],
    shot25: ["Frequent flyer", "Fly 25 m in one shot."],
    shot50: ["Long haul", "Fly 50 m in one shot."],
    shot75: ["Orbit", "Fly 75 m in one shot."],
    total150: ["Squadron", "Score 150 m in one game."],
    total250: ["Air force", "Score 250 m in one game."],
    cheers3: ["Crowd pleaser", "Three cheers in one game."],
    perfect: ["Flawless", "Five cheers in one game."],
    stack2: ["Double bubble", "Hold two bounce balls at once."],
    goldBall: ["Golden", "Catch a gold ball."],
    speedWind: ["Tailwind", "Catch speed and wind in one flight."],
    record: ["Personal best", "Beat your own record total."],
    daily: ["Daily flyer", "Finish a daily challenge."],
    streak3: ["Habit", "Daily challenges three days in a row."],
    duelWon: ["Ghostbuster", "Beat a friend's ghost."],
  },
  achievementsDone: (done, of) => `${done} of ${of}`,
  intro: {
    play: "Play",
    playSub: "Five hamsters, one tower",
    playDaily: "Play today's challenge",
    playDuel: "Race the ghost",
    duelSub: (m) => `To beat: ${m}`,
    daily: "Daily challenge",
    dailySub: (m) => (m === null ? "Same powerups for everyone" : `Today's best: ${m}`),
    freePlay: "Free play",
    freeSub: "A new sky every game",
    record: (m) => `Record ${m}`,
    streak: (days) => (days === 1 ? "1-day streak" : `${days}-day streak`),
    steps: (device) => {
      const press = { mouse: "Click", touch: "Tap", pad: "Press A" }[device];
      const again = { mouse: "click again", touch: "tap again", pad: "press A again" }[device];
      const hold = { mouse: "Hold the button", touch: "Keep your finger down", pad: "Hold A" }[
        device
      ];
      return [
        ["Jump", `${press}${device === "mouse" ? " or press Space" : ""} to set the hamster off.`],
        [
          "Hit the pillow",
          `When the hamster lines up with the pillow, ${again}. One swing per jump.`,
        ],
        ["Glide", `${hold} in flight to glide. The meter refills slowly.`],
      ];
    },
    keys: [
      ["P", "pause"],
      ["M", "music"],
      ["S", "sounds"],
      ["F", "full screen"],
      ["I", "help"],
    ],
    padKeys: [
      ["A", "jump, swing, glide"],
      ["Start", "pause"],
    ],
    items: {
      speed: ["Rocket", "A burst of speed, straight ahead."],
      wind: ["Propeller", "Lifts you for as long as you are in it."],
      slide: ["Skateboard", "Rolls on along the ground instead of stopping."],
      bounce: ["Bounce ball", "Your next landing bounces you back up."],
      superbounce: ["Gold ball", "A higher, faster bounce."],
      rebound: ["Springboard", "On the ground: throws you back into the air."],
    },
  },
  boot: {
    loading: "loading…",
    loadingPercent: (percent) => `loading ${percent}%`,
    reload: "Reload",
    noArt: "Couldn't load the game art. Check your connection and reload.",
    crashed: "Something went wrong. Reload to play on.",
    noStart: "The game couldn't start in this browser. Reload to try again.",
  },
};

const DE_HUD: HudStrings = {
  distanceLabel: "Weite",
  totalLabel: "gesamt",
  triesLabel: "Versuch",
  launchLabel: "Absprung",
  glide: "Gleiten",
  paused: (tap) =>
    tap ? "Pause - tippen zum Weiterspielen" : "Pause - Klick, Leertaste oder P zum Weiterspielen",
  jump: (tap) => `${tap ? "Tippen" : "Klicken"} zum Springen`,
  missed: "Daneben - warte auf die Landung",
  getReady: "Achtung...",
  swing: (tap) => `Nochmal ${tap ? "tippen" : "klicken"} - triff das Kissen`,
  hold: "Halten zum Gleiten",
  total: (distance) => `${distance} gesamt`,
  playAgain: (distance, tap) =>
    `${distance} gesamt - ${tap ? "tippen" : "klicken"} für ein neues Spiel`,
  ghost: "Geist",
  record: "Rekord",
};

const DE: Strings = {
  hud: DE_HUD,
  page: {
    howTo:
      "Klick oder <kbd>Leertaste</kbd> zum Springen, nochmal klicken, um das Kissen zu treffen, dann halten zum Gleiten. Ein Schlag pro Sprung; ein Fehlschlag kostet keinen Versuch. <kbd>P</kbd>, <kbd>Esc</kbd> oder der Eck-Knopf pausieren; ein Klick spielt weiter. <kbd>M</kbd> oder die Note schaltet die Musik stumm, <kbd>S</kbd> die Soundeffekte; <kbd>F</kbd> schaltet auf Vollbild und <kbd>I</kbd> öffnet diese Hilfe. Ein Gamepad geht auch: <kbd>A</kbd> ist der Knopf, <kbd>Start</kbd> pausiert.",
    physics: "Die Physik läuft mit festen 20&nbsp;Hz, wie im Original.",
    credits:
      "Eine Fan-Neuumsetzung auf Grundlage einer Bytecode-Analyse des originalen Flash-Spiels. Nicht mit dem ursprünglichen Herausgeber verbunden. Die Grafiken stammen aus dem originalen SWF und gehören ihren jeweiligen Eigentümern.",
    rotate: "Dreh dein Handy quer für eine größere Bühne.",
    settings: "Einstellungen",
    sfx: "Soundeffekte",
    volume: "Lautstärke",
    haptics: "Vibration",
    language: "Sprache",
    langAuto: "Automatisch",
    achievements: "Erfolge",
    info: "Hilfe und Credits",
    tagline: "Schleuder die Hamster - so weit sie fliegen.",
    controlsTab: "So geht's",
    itemsTab: "Items",
    introSettings: "Ton und Sprache",
    music: "Musik",
    stage: "Spielfeld",
    close: "Schließen",
    copyLink: "Link zum Kopieren",
    itemsHint:
      "Im Flug zeigt die Karte oben rechts, wo sie liegen - Punkte in diesen Farben, blass am Rand, wenn sie weiter weg sind.",
  },
  pause: "Pause",
  resume: "Weiter",
  muteMusic: "Musik stumm",
  unmuteMusic: "Musik an",
  muteSfx: "Soundeffekte stumm",
  unmuteSfx: "Soundeffekte an",
  fullscreen: "Vollbild",
  exitFullscreen: "Vollbild beenden",
  results: {
    title: "Spiel vorbei",
    newRecord: "Neuer Rekord!",
    dailyTitle: (day) => `Tages-Challenge ${day}`,
    duelTitle: "Duell",
    shot: (n) => `Hamster ${n}`,
    total: "Gesamt",
    best: "bester",
    personalBest: (m) => `Dein Rekord: ${m}`,
    dailyBest: (m) => `Heute bestes: ${m}`,
    streak: (days) => (days === 1 ? "1 Tag in Folge" : `${days} Tage in Folge`),
    duelWon: (m) => `Du gewinnst mit ${m} Vorsprung!`,
    duelLost: (m) => `Der Geist gewinnt mit ${m} Vorsprung.`,
    duelTied: "Totes Rennen!",
    playAgain: "Nochmal",
    rematch: "Revanche",
    daily: "Tages-Challenge",
    freePlay: "Freies Spiel",
    share: "Freund herausfordern",
    unlocked: "In diesem Spiel freigeschaltet",
  },
  toast: {
    duel: (m) => `Duell: schlag die ${m} des Geists`,
    daily: (m) =>
      m === null
        ? "Tages-Challenge: heute für alle dieselben Powerups"
        : `Tages-Challenge: schlag ${m}`,
    badRun: "Dieser Herausforderungs-Link ließ sich nicht abspielen - freies Spiel.",
    shotRecord: (m) => `Neuer weitester Wurf: ${m}`,
    copied: "Link kopiert - schick ihn jemandem, der gegen deinen Geist fliegen soll",
    shareText: (m) => `Ich bin ${m} weit geflogen in HamsterFlight. Schlägst du meinen Geist?`,
    achievement: (title) => `Erfolg: ${title}`,
  },
  achievements: {
    firstCheer: ["Gelandet", "Einen Wurf mit Jubel beenden."],
    shot25: ["Vielflieger", "25 m mit einem Wurf."],
    shot50: ["Langstrecke", "50 m mit einem Wurf."],
    shot75: ["Umlaufbahn", "75 m mit einem Wurf."],
    total150: ["Staffel", "150 m in einem Spiel."],
    total250: ["Luftflotte", "250 m in einem Spiel."],
    cheers3: ["Publikumsliebling", "Dreimal Jubel in einem Spiel."],
    perfect: ["Makellos", "Fünfmal Jubel in einem Spiel."],
    stack2: ["Doppelblase", "Zwei Hüpfbälle gleichzeitig."],
    goldBall: ["Goldig", "Einen goldenen Ball fangen."],
    speedWind: ["Rückenwind", "Speed und Wind in einem Flug."],
    record: ["Bestleistung", "Den eigenen Rekord schlagen."],
    daily: ["Tagesflieger", "Eine Tages-Challenge beenden."],
    streak3: ["Gewohnheit", "Drei Tage in Folge Tages-Challenge."],
    duelWon: ["Geisterjäger", "Den Geist eines Freundes schlagen."],
  },
  achievementsDone: (done, of) => `${done} von ${of}`,
  intro: {
    play: "Spielen",
    playSub: "Fünf Hamster, ein Turm",
    playDaily: "Tages-Challenge spielen",
    playDuel: "Gegen den Geist fliegen",
    duelSub: (m) => `Zu schlagen: ${m}`,
    daily: "Tages-Challenge",
    dailySub: (m) => (m === null ? "Heute für alle dieselben Powerups" : `Heute bestes: ${m}`),
    freePlay: "Freies Spiel",
    freeSub: "Jedes Spiel ein neuer Himmel",
    record: (m) => `Rekord ${m}`,
    streak: (days) => (days === 1 ? "1 Tag in Folge" : `${days} Tage in Folge`),
    steps: (device) => {
      const press = { mouse: "Klick oder Leertaste", touch: "Tippen", pad: "A drücken" }[device];
      const again = { mouse: "nochmal klicken", touch: "nochmal tippen", pad: "nochmal A" }[device];
      const hold = { mouse: "Maustaste halten", touch: "Finger halten", pad: "A halten" }[device];
      return [
        ["Springen", `${press}: Der Hamster legt los.`],
        [
          "Kissen treffen",
          `Steht der Hamster auf Höhe des Kissens: ${again}. Ein Schlag pro Sprung.`,
        ],
        ["Gleiten", `Im Flug ${hold} zum Gleiten. Die Leiste lädt sich langsam wieder auf.`],
      ];
    },
    keys: [
      ["P", "Pause"],
      ["M", "Musik"],
      ["S", "Sounds"],
      ["F", "Vollbild"],
      ["I", "Hilfe"],
    ],
    padKeys: [
      ["A", "springen, schlagen, gleiten"],
      ["Start", "Pause"],
    ],
    items: {
      speed: ["Rakete", "Ein kräftiger Schub geradeaus."],
      wind: ["Propeller", "Trägt dich nach oben, solange du drin bist."],
      slide: ["Skateboard", "Rollt am Boden weiter, statt zu bremsen."],
      bounce: ["Hüpfball", "Die nächste Landung federt dich wieder hoch."],
      superbounce: ["Goldball", "Ein höherer, schnellerer Sprung."],
      rebound: ["Sprungbrett", "Am Boden: schleudert dich zurück in die Luft."],
    },
  },
  boot: {
    loading: "lädt…",
    loadingPercent: (percent) => `lädt ${percent}%`,
    reload: "Neu laden",
    noArt: "Die Spielgrafik ließ sich nicht laden. Prüf die Verbindung und lade neu.",
    crashed: "Etwas ist schiefgelaufen. Neu laden, um weiterzuspielen.",
    noStart: "Das Spiel ließ sich in diesem Browser nicht starten. Neu laden zum Wiederholen.",
  },
};

export const STRINGS: Readonly<Record<Lang, Strings>> = { en: EN, de: DE };

/**
 * `?lang=` first, then the saved choice, then the browser's list. Anything
 * German is German; everything else is English, the original's language.
 */
export function pickLang(
  query: string | null,
  saved: Lang | null,
  browser: readonly string[],
): Lang {
  if (query === "en" || query === "de") return query;
  if (saved !== null) return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "de") return "de";
    if (base === "en") return "en";
  }
  return "en";
}

/**
 * Fills every `[data-i18n]` element from `page` and sets the document's
 * language. The strings are this module's own constants, never input, so
 * the help text can carry its `<kbd>` markup.
 */
export function applyPage(root: Document, lang: Lang): void {
  const t = STRINGS[lang];
  root.documentElement.lang = lang;
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset["i18n"] as PageKey | undefined;
    if (key !== undefined && key in t.page) el.innerHTML = t.page[key];
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-label]")) {
    const key = el.dataset["i18nLabel"] as PageKey | undefined;
    if (key !== undefined && key in t.page) el.setAttribute("aria-label", t.page[key]);
  }
}
