import { ProgressionManager } from "./ProgressionManager";

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const NPC_NAMES = [
  "Granny Maple", "Old Barnaby", "Professor Wren", "Captain Moss",
  "Baker Finch", "Nana Clover", "Postmaster Quill", "Tinker Lark",
  "Widow Hazel", "Farmer Oats", "Mayor Bramble", "Auntie Rue",
  "Cobbler Pip", "Shepherd Fable", "Librarian Sage", "Warden Flint",
  "Tailor Wynn", "Fisherman Cork", "Beekeeper Thyme", "Clockmaker Gale",
];

/** Used for dialogue SFX pitch (lower playback rate for male NPCs). */
const MALE_NPC_NAMES = new Set<string>([
  "Old Barnaby",
  "Professor Wren",
  "Captain Moss",
  "Postmaster Quill",
  "Tinker Lark",
  "Farmer Oats",
  "Mayor Bramble",
  "Cobbler Pip",
  "Warden Flint",
  "Fisherman Cork",
  "Beekeeper Thyme",
  "Clockmaker Gale",
]);

export function isNpcMale(npcName: string): boolean {
  return MALE_NPC_NAMES.has(npcName);
}

const NPC_PORTRAIT_FILES: Record<string, string> = {
  "Granny Maple": "granny_maple.png",
  "Old Barnaby": "old_barnaby.png",
  "Professor Wren": "professor_wren.png",
  "Captain Moss": "capatain_moss.png",
  "Baker Finch": "baker_finch.png",
  "Nana Clover": "nana_clover.png",
  "Postmaster Quill": "postmaster_quill.png",
  "Tinker Lark": "tinker_lark.png",
  "Widow Hazel": "widow_hazel.png",
  "Farmer Oats": "farmer_oats.png",
  "Mayor Bramble": "mayor_bramble.png",
  "Auntie Rue": "auntie_rue.png",
  "Cobbler Pip": "cobbler_pip.png",
  "Shepherd Fable": "shepherd_fable.png",
  "Librarian Sage": "librarian_sage.png",
  "Warden Flint": "warden_flint.png",
  "Tailor Wynn": "tailor_wynn.png",
  "Fisherman Cork": "fisherman_cork.png",
  "Beekeeper Thyme": "beekeeper_thyme.png",
  "Clockmaker Gale": "clockmaster_gale.png",
  "Professor Astrid": "professor_astrid.png",
  "Stargazer Orion": "stargazer_orion.png",
  "Doctor Celeste": "doctor_celeste.png",
  "Sky Jellyfish": "jellyfish.png",
};

export function getNpcPortraitUrl(npcName: string): string {
  if (npcName === "Eternal Flame") return "/2D/eternal_flame.png";
  const file = NPC_PORTRAIT_FILES[npcName];
  return file ? `/npc/${file}` : "";
}

/** Carpet sky-jellyfish quest speaker (see {@link getJellyfishCaptureLine}). */
export const JELLYFISH_NPC_SPEAKER = "Sky Jellyfish";

/**
 * Line after each sky jellyfish is caught. `collectedAfterCapture` is
 * {@link SkyJellyfish#getCollectedCount} immediately after that catch (1…total).
 */
export function getJellyfishCaptureLine(
  collectedAfterCapture: number,
  total: number,
): string {
  const remaining = total - collectedAfterCapture;
  if (collectedAfterCapture === 1) {
    return `I am separated from my kin. Please find them. There are ${remaining} more to find.`;
  }
  if (remaining <= 0) {
    return "All of us are together again. Thank you.";
  }
  if (remaining === 1) {
    return "There is 1 more to find.";
  }
  return `There are ${remaining} more to find.`;
}

/** Cosmic-void intro; shown via {@link PackageQuestHUD#showBubble} as two sequential lines. */
export const ETERNAL_FLAME_SPEAKER = "Eternal Flame";
export const ETERNAL_FLAME_VOID_BUBBLES: readonly [string] = [
  "Defend me! Lunar moths hunger for the last ember. Please, do not let them reach the flame.",
];

/**
 * Dialogue spoken by the Eternal Flame between waves.
 * Index 0 = after wave 1 clears (before wave 2), index 1 = after wave 2 clears (before wave 3).
 */
export const VOID_WAVE_BETWEEN_DIALOGUE: readonly [string, string] = [
  "The scouts fall. But the Hungering Flight follows — centuries-old moth-kin. Do not let them reach me.",
  "One last surge — the Mothwing Eldest. Hold this light. It will outlast the dark.",
];

/**
 * Warnings spoken when the shield HP drops to thresholds.
 * Index 0 = at or below 50% HP, index 1 = at or below 3 HP (critical).
 */
export const VOID_SHIELD_LOW_HP_DIALOGUE: readonly [string, string] = [
  "I feel the cold creeping in — each strike dims the light inside me. Guard the flame while you still can.",
  "I am nearly gone. I have burned since before your stars were named. Please — do not let this be where I end.",
];

/** Spoken by the Eternal Flame the moment a moth breaches the shield and shatters it. */
export const VOID_FLAME_SHATTER_DIALOGUE =
  "No... the moths have taken the light. I am... gone.";

/**
 * Spoken by the Eternal Flame after the player survives all three waves.
 * Index 0 = gratitude, index 1 = willing sacrifice / purpose revealed.
 */
export const VOID_VICTORY_DIALOGUE: readonly [string, string] = [
  "You held the light when all others fled. I have waited centuries for a guardian such as you. Thank you.",
  "I am ready. Carry my flame to the five ancient braziers — all five. It is the only thing that can stop what falls from the sky. This is what I was born for.",
];

/**
 * Pickup lines by moon phase — each pool uses **items that fit the tone**:
 * - Calm: everyday cosy parcels (jam, gifts, hobbies).
 * - Urgent: deadlines, warnings, important documents (handwritten letter, medicine, sealed orders).
 * - Frantic: survival / last deliveries (emergency supplies, rations, don't ask).
 */

// Moon < 0.5 — mundane, cosy parcels.
const PICKUP_TEMPLATES = [
  "Could you take this to {dest}? {receiver} has been waiting for days!",
  "A parcel for {dest}! Handle with care, it's full of jam.",
  "Quick delivery to {dest}, please! It's a surprise birthday gift.",
  "This needs to reach {dest} before sundown. Well... before the clouds roll in.",
  "Help! My pen pal in {dest} needs this letter. And the cookies I baked.",
  "Oh, a pilot! Could you fly this to {dest}? The roads are far too winding.",
  "Special order for {dest}. {receiver} will know what it is. Very hush-hush.",
  "One jar of pickles to {dest} — the village fair judges are waiting.",
  "This telescope belongs to {receiver} in {dest}. They lent it ages ago!",
  "A care package for {dest}. Mostly socks. Everyone needs socks.",
  "Please bring this to {dest}! It's a music box — fragile!",
  "Delivery for {dest}: one scarf, hand-knitted. Took me all winter.",
  "Would you mind? {receiver} in {dest} ordered a book. Three months ago.",
  "This pie needs to get to {dest} while it's still warm. Fly fast!",
  "A package of seeds for the garden in {dest}. Spring waits for no one!",
  "It's just a little box of chocolates for {receiver}. Don't eat any!",
  "Take this map to {dest}. {receiver} drew the first half, I drew the rest.",
  "This crate of honey goes to {dest}. The bees worked very hard.",
  "Could you bring this compass to {receiver}? They keep getting lost.",
  "A jar of fireflies for {dest}. They light up the whole square!",
  "This quilt belongs in {dest}. Every stitch tells a story.",
  "One crate of fresh lemons for {dest}. {receiver} makes the best lemonade!",
  "{receiver} forgot their lucky hat here. Please fly it back to {dest}!",
  "Careful with this — it's a snow globe of {dest}. Very sentimental.",
  "A bundle of letters for {dest}. The village hasn't had mail in weeks!",
  "This lantern was crafted for {receiver}. It glows in seven colors!",
  "Fly this kite to {dest} — it's for the children's festival.",
  "One barrel of apple cider for {dest}. Don't let it slosh!",
  "Sheet music for the choir in {dest} — rehearsal is tomorrow, no rush.",
];

/** Moon 0.5–0.75 — serious deadlines, warnings, critical goods (not yet last-second panic). */
const PICKUP_TEMPLATES_URGENT = [
  "This handwritten letter must reach {receiver} in {dest} — it explains the evacuation plan.",
  "Sealed medical supplies for the clinic in {dest}. {receiver} is running out by the hour.",
  "Hurry — take this dossier to {dest} before the council meets. {receiver} needs to read it in person.",
  "The moon looks wrong. Get this telescope to {receiver} in {dest} — they need to confirm the readings.",
  "A handwritten will for {receiver} in {dest}. They asked for it before dark.",
  "These are signed shelter blueprints — {dest} must receive them before ground breaks.",
  "Take this satchel of medicine to {dest}. Half the village is counting on {receiver}.",
  "A courier's satchel of witness statements — {dest} needs them before the hearing tonight.",
  "This pie needs to reach {dest} before the storm front — {receiver} won't eat once they're on watch.",
  "Battery packs and spare valves for the signal station in {dest}. {receiver} is holding the line.",
  "A sealed envelope from the mayor — only {receiver} in {dest} may open it.",
  "This radio kit goes to {dest}. {receiver} needs to assemble it before nightfall.",
  "Last crate of preserved food for the cellars in {dest}. Don't let it sit out.",
  "A handwritten prayer list for {receiver} — families in {dest} need to know who's accounted for.",
  "Take these keys to {dest}. {receiver} must lock the vault before curfew.",
  "The choir's sheet music for tonight's vigil in {dest} — late is not an option.",
  "A wax-sealed letter from the lighthouse — {receiver} in {dest} knows what it means.",
  "This crate of bandages and splints for {dest}. {receiver} is expecting a busy night.",
];

/** Moon ≥ 0.75 — survival, emergency supplies, last possible deliveries. */
const PICKUP_TEMPLATES_FRANTIC = [
  "EMERGENCY SUPPLIES for {dest}! Water, rations, blankets — move!",
  "This crate is marked EMERGENCY — get it to {receiver} in {dest} — NOW!",
  "Don't ask what's inside — just fly it to {dest}. {receiver} will know what to do!",
  "Last satchel of medical kits and burn dressings for {dest}! GO!",
  "Evacuation tags for the children — {dest} must receive them before the shelters seal!",
  "Distress flares and signal powder — {receiver} in {dest} needs this to guide people!",
  "Emergency rations and purification tablets — {dest} runs out in minutes!",
  "This might be the last delivery anyone ever makes. Emergency supplies to {dest}!",
  "TAKE IT! Emergency blankets and rope for {dest} — the ground is splitting!",
  "The final coded message — only {receiver} in {dest} can broadcast it!",
  "If {dest} doesn't get this emergency crate, nothing else matters anyway!",
  "First-aid, tourniquets, and plasma — {receiver} said they have seconds left!",
  "No time to explain — emergency supplies for {dest}! Fly!",
  "Last oxygen canisters for the infirmary in {dest}! Please — RUN!",
  "Signal lanterns and fuel — {receiver} needs to light the way out!",
  "Emergency rations and baby formula — {dest} is out of everything!",
  "Take it! Take it and fly! Don't look up — emergency supplies for {dest}!",
  "The sky is falling — get this trauma kit to {receiver} in {dest}!",
];

/** Moon 0.5–0.75 — relief mixed with dread; may reference letters, medicine, sealed orders. */
const DELIVERY_TEMPLATES_URGENT = [
  "The letter — thank the skies. I'll read every word before we lock down.",
  "Medical supplies in one piece. You may have saved more than you know.",
  "Have you seen the moon? I'm scared — but this helps us prepare.",
  "The sealed envelope... good. Tell {sender} we're following the plan.",
  "You made it. I wasn't sure anyone would, with the sky like that.",
  "The telescope — {sender} was right to rush this. We see it now.",
  "Shelter blueprints received. Tell {sender} we start tonight.",
  "Finally! Tell {sender} to get underground if they still can.",
  "Thank you. I hope this isn't the last delivery I ever receive.",
  "You're braver than most. The others have stopped flying entirely.",
  "{sender} always keeps their promises. Even now. Bless them.",
  "We needed this. The village is frightened. Stay safe, pilot.",
  "The keys — the vault's secure. Thank you, pilot.",
  "Radio kit's here. We might still reach someone before dark.",
  "Bandages accounted for. {sender} didn't exaggerate the hurry.",
  "The wax-sealed letter... I'll do what it says. Go. Fly safe.",
  "Witness statements delivered. At least the record will be straight.",
  "Preserved food for the cellars — we'll stretch it as long as we can.",
  "Prayer list in hand. I'll read every name aloud tonight.",
  "Sheet music for the vigil — the choir can sing one more time.",
];

/** Moon ≥ 0.75 — panic; emergency supplies received or too late. */
const DELIVERY_TEMPLATES_FRANTIC = [
  "THE CRATE! Put it down — we'll unload! NOW GET OUT OF HERE!",
  "Emergency supplies — you actually made it?! GO! Don't look back!",
  "Don't ask what's inside — we're using it all. Thank you — RUN!",
  "Evacuation tags — the children — thank you — the shelters are sealing!",
  "Flares! We can still signal — pilot, FLY!",
  "Rations — water — it's here — now save yourself!",
  "The coded message — I'll broadcast — GO! THE SKY IS COMING DOWN!",
  "Trauma kits — stack them THERE! Pilot, I love you — LEAVE!",
  "Last oxygen — unload! There's no time for goodbyes!",
  "Lanterns — fuel — if anyone survives they'll see the light — thank you!",
  "Baby formula — you beautiful fool — RUN!",
  "Emergency blankets — pile them on — thank you — I think we're done for!",
  "Plasma and tourniquets — {sender} sent a saint — NOW RUN!",
  "Nothing matters anymore — but you brought hope for five more minutes — GO!",
  "I can't believe you made it. The ground won't stop shaking — RUN!",
  "Tell {sender} I said goodbye if you see them — and thank you — GO!",
  "You're insane for still flying! Thank you — now LEAVE!",
  "Bless you, pilot. If we survive this, I owe you everything.",
  "The sky is tearing open — supplies are here — SAVE YOURSELF!",
];

// Moon < 0.5 — warm, everyday thanks (jam, cake, gifts).
const DELIVERY_TEMPLATES = [
  "Finally! I was about to send a carrier pigeon instead.",
  "You made it! The whole village was starting to worry.",
  "Marvelous! This is exactly what we needed. You're a legend!",
  "Right on time! Well, close enough. Thank you, pilot!",
  "At last! I thought it got lost in the clouds.",
  "Wonderful! Now the festival can begin. You saved the day!",
  "Oh my, it's here! I'll put the kettle on to celebrate.",
  "Brilliant delivery! You fly faster than the village gossip.",
  "Three cheers for the pilot! This calls for cake.",
  "It arrived in one piece! That's more than the last courier managed.",
  "You're a lifesaver! Or at least, a pickle-saver.",
  "Incredible! I didn't think anyone would brave the winds today.",
  "Safe and sound! Tell {sender} I said thank you. And give them a hug.",
  "The package! Quick, nobody look — it's a surprise.",
  "Thank you, brave pilot! The skies are friendlier with you in them.",
  "I knew {sender} wouldn't forget! You've made my whole week.",
  "Ha! {sender} actually sent it. I owe them a pie now.",
  "Oh, it's even better than I imagined. {sender} has wonderful taste!",
  "At last! I was about to fly there myself. Well, walk. I can't fly.",
  "You must be exhausted! Stay for some tea? No? More deliveries? Of course.",
  "The whole village is cheering! Well, the three of us. Small village.",
  "Splendid! I'll write {sender} a thank-you note. Could you deliver that too?",
  "Not a scratch on it! You're the best pilot this side of the globe.",
  "Oh, the colors! {sender} always picks the prettiest wrapping.",
  "I can already smell the cookies inside. Thank you, pilot!",
  "Perfect timing — I was just about to give up hope!",
  "You flew through those clouds for this? You deserve a medal!",
  "Wait, there's a note inside... oh, that's sweet. Thank {sender} for me!",
  "The children are going to be so happy. You've no idea!",
  "A true sky courier! {sender} was right to trust you.",
];

/**
 * 0-based quest index. At this index, the **delivery** step is the 3rd completed package (NPC gives heirloom line).
 * Paired with {@link THIRD_PACKAGE_HEIRLOOM_DELIVERY_TEMPLATES} and third-delivery eternal flame in Game.
 */
export const THIRD_PACKAGE_DELIVERY_INDEX = 2;

const THIRD_PACKAGE_HEIRLOOM_DELIVERY_TEMPLATES = [
  "You kept your word, pilot — and I keep mine. This is the eternal flame from my own hearth: my family passed it down for generations. I want you to have it. You've earned a piece of us.",
  "The box was a formality. The true gift is this: our family heirloom, an eternal flame that never left our line — until now. Please take it. I'd rather it flew with you than sat on my shelf.",
  "{sender} said you were the one to trust, and I believe them. This flame has warmed three generations. Carry it, pilot — the sky is your hearth now — and thank you for the delivery.",
  "My grandmother swore to give this away only to someone who'd run three perfect errands for the village. You just did. It's an eternal flame, our oldest treasure. It's yours, truly.",
  "Here — the parcel was nothing next to this. The eternal flame in my family, the one story we're proudest of. I'm handing it to you. Treat it as your own; you've saved more than a weekend with those flights.",
];

export interface QuestDialogue {
  senderName: string;
  receiverName: string;
  pickupLine: string;
  deliveryLine: string;
}

export function generateQuestDialogue(
  seed: number,
  questIndex: number,
  destName: string,
  moonProgress = 0,
): QuestDialogue {
  const rand = seededRandom(seed * 3571 + questIndex * 113);

  const senderIdx = Math.floor(rand() * NPC_NAMES.length);
  let receiverIdx = Math.floor(rand() * NPC_NAMES.length);
  if (receiverIdx === senderIdx) {
    receiverIdx = (receiverIdx + 1) % NPC_NAMES.length;
  }
  const senderName = NPC_NAMES[senderIdx];
  const receiverName = NPC_NAMES[receiverIdx];

  let pickupPool: string[];
  let deliveryPool: string[];
  if (moonProgress >= 0.75) {
    pickupPool = PICKUP_TEMPLATES_FRANTIC;
    deliveryPool = DELIVERY_TEMPLATES_FRANTIC;
  } else if (moonProgress >= 0.5) {
    pickupPool = PICKUP_TEMPLATES_URGENT;
    deliveryPool = DELIVERY_TEMPLATES_URGENT;
  } else {
    pickupPool = PICKUP_TEMPLATES;
    deliveryPool = DELIVERY_TEMPLATES;
  }

  let pickupLine = pickupPool[Math.floor(rand() * pickupPool.length)];
  pickupLine = pickupLine
    .replace(/\{dest\}/g, destName)
    .replace(/\{receiver\}/g, receiverName);

  let deliveryLine = deliveryPool[Math.floor(rand() * deliveryPool.length)];
  deliveryLine = deliveryLine.replace(/\{sender\}/g, senderName);

  if (
    questIndex === THIRD_PACKAGE_DELIVERY_INDEX &&
    !ProgressionManager.loadPlayerWorldState().packageThirdDeliveryEternalFlameClaimed
  ) {
    const heirloomLine =
      THIRD_PACKAGE_HEIRLOOM_DELIVERY_TEMPLATES[
        Math.floor(rand() * THIRD_PACKAGE_HEIRLOOM_DELIVERY_TEMPLATES.length)
      ]!;
    deliveryLine = heirloomLine.replace(/\{sender\}/g, senderName);
  }

  return { senderName, receiverName, pickupLine, deliveryLine };
}

/** Cosy hot-air-balloon NPC greetings (reuse same NPC names + portraits as package quest). */
/** Straight talk: gremlins, sky pests (mixed in sometimes with balloon greetings). */
const BALLOON_GREETINGS_GREMLINS = [
  "Watch the clouds — gremlins love to nip at wings. Paintball helps!",
  "If something small and rude buzzes your plane, that's a gremlin. Harmless. Usually.",
  "They say a big gremlin — a Gremlin King — hides in the highest flock. Probably a tall tale.",
  "Gremlins again last week. Stole my sandwich from the basket. Little thieves!",
  "You look like you've met gremlins before. The scuff marks on your wings tell the story.",
  "Eternal flames? Old pilots swear the Gremlin King drops one if you best him. Could be true!",
];

const BALLOON_GREETINGS = [
  "Oh hello up there! Fancy meeting you in the tiny skies!",
  "Lovely day for a wander, isn't it? The clouds are extra fluffy today.",
  "Mind the breeze — and the tea in the basket is still warm!",
  "Hullo! We waved from the basket but you were a bit too fast!",
  "Tiny skies, big dreams — safe travels, friend!",
  "A little wave from the balloon basket! Isn't the view darling?",
  "Slow down if you can — we'd love a proper chat!",
  "The wind is gentle and the mood is cosy. Come say hi again sometime!",
  "You're flying like a happy bird! We approve.",
  "If you see a cloud shaped like a muffin, that was ours.",
  "Warm socks and a warm balloon — that's the life!",
  "Hello, traveller! The world looks so small from up here.",
  "Cheerio! Save some sky for the rest of us!",
  "We're just drifting and dreaming. You look busy — in a good way!",
  "Snug as a bug in a basket! Wave if you fly past again!",
  "The stars will be out soon — save some wonder for tonight!",
  "A cup of cocoa and a patch of blue — that's all we need.",
  "You're making the sky look easy! Bravo!",
  "Floaty greetings from the wicker seat!",
  "May your tailwinds be kind and your landings soft!",
];

const BALLOON_GREETINGS_UNEASY_DAY = [
  "Is it just me, or can you see the moon? It's the middle of the day...",
  "The moon shouldn't be out right now. That's... not normal, is it?",
  "I've never seen the moon that big during the day. Have you?",
  "Something about the sky feels wrong today. Can you see it too?",
  "My grandmother told stories about the moon showing its face by day. None of them ended well.",
  "The birds have gone quiet. And the moon... why is it so close?",
  "I don't want to alarm you, but look up. Does that seem right to you?",
  "The clouds are thin and the moon is fat. I don't like it one bit.",
  "I've been up in this balloon forty years. Never seen the moon like that in daylight.",
  "Don't stare at it too long. It almost looks like it's... moving.",
];

const BALLOON_GREETINGS_UNEASY_NIGHT = [
  "Is it just me, or is the moon awfully close tonight?",
  "I've been watching the moon all evening. It's getting bigger. I'm sure of it.",
  "The stars look dimmer than usual. The moon is drowning them out.",
  "Beautiful night, isn't it? Almost too beautiful. The moon is enormous.",
  "My old bones are aching. They always do when the moon gets strange.",
  "That moon... it was half this size last night. I'd swear on my balloon.",
  "The tides will be wild tonight. Look at the size of that thing.",
  "Something's not right up there. The moon doesn't just grow like that.",
  "I used to love full moons. This one gives me the shivers.",
  "Have you noticed? The moonlight is so bright it's casting double shadows.",
];

const BALLOON_GREETINGS_PANIC = [
  "We need to land — RIGHT NOW!",
  "It's heading straight for us! Can't you see it?!",
  "This is the end, isn't it? Tell me it isn't.",
  "LOOK AT THE SKY! Why is nobody doing anything?!",
  "I can't breathe. The moon — it's so close I can see the craters.",
  "We're all going to... no. No no no no no.",
  "Get away from here! Fly as far as you can!",
  "My balloon can't go fast enough. Nothing can.",
  "I always thought I'd go peacefully. Not like this.",
  "Someone PLEASE do something! It's almost here!",
  "The whole world is shaking! Can you feel it?!",
  "I can hear it. The sky is groaning. We're out of time.",
  "Forget the deliveries, forget everything — just RUN!",
  "Hold your loved ones close, pilot. There's no time left.",
  "If this is our last flight... it was nice meeting you.",
];

const PANIC_LINES_GREMLINS = [
  "Gremlins everywhere — as if the moon wasn't enough!",
  "The gremlins are laughing at us! I can hear them!",
  "I'd take a gremlin over that moon any day — at least gremlins are small!",
];

const PANIC_LINES = [
  "Did you see the size of that thing?! It's ENORMOUS!",
  "The moon! THE MOON! It's going to crush us all!",
  "I can't stop shaking. Look at the sky. LOOK AT IT!",
  "We're all doomed. Every last one of us.",
  "Someone do something! Anyone! PLEASE!",
  "I told them this would happen! Nobody listened!",
  "The animals are fleeing. Even they know.",
  "My house is crumbling from the tremors!",
  "Has anyone seen my children? Where are my children?!",
  "Pray. Just pray. There's nothing else we can do.",
  "It's so close I can feel the heat. Is that possible?!",
  "This is a nightmare. Please let this be a nightmare.",
  "I should have told them I loved them more often.",
  "The ocean is pulling back from the shore. It's really happening.",
  "If any pilot can hear me — is there any hope left?",
];

/**
 * Random NPC + greeting line for balloon proximity (same portrait pool as package quests).
 * Uses Math.random() — the old seeded LCG often produced the same first draw (e.g. Old Barnaby)
 * for nearby seeds; balloon lines don’t need to match across clients.
 */
export function pickBalloonGreeting(
  _seed: number,
  _balloonIndex: number,
  _salt: number,
  moonProgress: number,
  isDay: boolean,
): { npcName: string; line: string } {
  const npcName = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]!;
  if (moonProgress < 0.75 && Math.random() < 0.14) {
    const line =
      BALLOON_GREETINGS_GREMLINS[
        Math.floor(Math.random() * BALLOON_GREETINGS_GREMLINS.length)
      ]!;
    return { npcName, line };
  }
  let pool: string[];
  if (moonProgress >= 0.75) {
    pool = BALLOON_GREETINGS_PANIC;
  } else if (moonProgress >= 0.5) {
    pool = isDay ? BALLOON_GREETINGS_UNEASY_DAY : BALLOON_GREETINGS_UNEASY_NIGHT;
  } else {
    pool = BALLOON_GREETINGS;
  }
  const line = pool[Math.floor(Math.random() * pool.length)]!;
  return { npcName, line };
}

export function pickPanicLine(): { npcName: string; line: string } {
  const npcName = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]!;
  const line = Math.random() < 0.22
    ? PANIC_LINES_GREMLINS[Math.floor(Math.random() * PANIC_LINES_GREMLINS.length)]!
    : PANIC_LINES[Math.floor(Math.random() * PANIC_LINES.length)]!;
  return { npcName, line };
}

/* ── Observatory astronomer dialogue ──────────────────────────────── */

const ASTRONOMER_NAMES = [
  "Professor Astrid",
  "Stargazer Orion",
  "Doctor Celeste",
] as const;

MALE_NPC_NAMES.add("Stargazer Orion");

const ASTRO_CALM = [
  "The constellations are beautiful tonight. Have you seen Orion's belt?",
  "I've been charting the stars for years. Everything looks normal… for now.",
  "Come to stargaze? The skies are perfectly clear up here.",
  "I've been tracking a faint object near the horizon. Probably nothing.",
  "The telescope is calibrated. All the stars are exactly where they should be.",
  "There's a lovely nebula visible this evening. Care to look?",
];

const ASTRO_UNEASY = [
  "Something is off with the star charts. A few constellations seem… shifted.",
  "I keep rechecking my calculations. There's an object that shouldn't be there.",
  "The moon looks a touch bigger than my almanac says it should.",
  "I've sent word to the other observatories. They've noticed it too.",
  "My instruments aren't wrong. Something is moving toward us.",
  "The readings were normal last week. Now they're anything but.",
];

const ASTRO_DREAD = [
  "The moon is definitely closer. I can see new craters with the naked eye.",
  "I haven't slept in days. The readings are getting worse every hour.",
  "The tides have shifted. The ocean is pulling toward the sky.",
  "I've never seen anything like this in thirty years of astronomy.",
  "If my calculations are right… we have very little time.",
  "The gravitational pull is increasing. My pendulum clock has stopped.",
];

const ASTRO_PANIC = [
  "It's too late. The moon is falling. There's nothing we can do.",
  "Get out of here! The sky is collapsing!",
  "All my telescopes are shaking. The ground won't stop trembling.",
  "I'm so sorry. I should have warned everyone sooner.",
  "Look at the sky. That isn't the moon anymore. It's the end.",
];

/** Plain-spoken hints: moonstones (two halves), gremlins — mixed in by chance. */
const ASTRO_MOONSTONE_GREMLIN = [
  "The old moonstone sites — two pieces of one ring, buried on opposite sides of the world — show up weird on long exposures.",
  "Gremlins aren't myth. I've tracked fast-moving dots that match pilot reports. Stay sharp up there.",
  "If you ever fuse the moonstones, the readings go wild — then the braziers wake up. That's documented.",
  "The Gremlin King is the biggest gremlin in the sky flock. Astronomers don't put it in the journals, but pilots do.",
  "Gremlins steal lift and scratch paint. The Gremlin King is the one that drops an eternal flame — if you can beat it.",
  "Moonstone ruins: one half hums, the other answers. When both float, something bigger stirs.",
];

/**
 * Pick an observatory astronomer greeting based on moon progress.
 * @param observatoryIndex Which observatory (0–2) — determines the resident NPC.
 */
export function pickObservatoryGreeting(
  observatoryIndex: number,
  moonProgress: number,
): { npcName: string; line: string } {
  const npcName = ASTRONOMER_NAMES[observatoryIndex % ASTRONOMER_NAMES.length]!;
  if (moonProgress < 0.75 && Math.random() < 0.18) {
    const line =
      ASTRO_MOONSTONE_GREMLIN[
        Math.floor(Math.random() * ASTRO_MOONSTONE_GREMLIN.length)
      ]!;
    return { npcName, line };
  }
  let pool: readonly string[];
  if (moonProgress >= 0.75) pool = ASTRO_PANIC;
  else if (moonProgress >= 0.50) pool = ASTRO_DREAD;
  else if (moonProgress >= 0.25) pool = ASTRO_UNEASY;
  else pool = ASTRO_CALM;
  const line = pool[Math.floor(Math.random() * pool.length)]!;
  return { npcName, line };
}

/* ── Stonehenge whisper lines ─────────────────────────────────────── */

const STONEHENGE_CALM = [
  "The stone circle hums. You hear a whisper... \"The stones remember when the sky was whole.\"",
  "Standing inside the stone circle, a vision stirs... lanterns floating upward, each one a prayer unanswered.",
  "Something is carved into the stone circle: \"When the moon swells, keep your eyes on the horizon.\"",
  "The stone circle resonates. You hear a whisper... \"They built this circle to watch the sky. They stopped watching.\"",
  "The shadows cast by the stone circle always point toward the moon, no matter the hour.",
  "A clear carving names the moonstones: two halves of one ring, split across the world until someone joins them again.",
  "Someone scratched into the stone: gremlins in the clouds — small trouble. The moon is the big trouble.",
];

const STONEHENGE_UNEASY = [
  "The stone circle leans as if drawn toward something. A vision stirs... the moon, closer than it should be.",
  "You hear a whisper from the stone circle... \"Count the stars between the pillars. There are fewer than before.\"",
  "The ground around the stone circle vibrates faintly. An inscription reads: \"The circle holds as long as the sky does.\"",
  "A vision ripples through the stone circle... a constellation rearranging itself. One star missing.",
  "You hear a whisper from the stones... \"Do not mistake warning for rescue.\"",
  "Words appear in the dust: light the five braziers with eternal flame — real eternal flame — and the moon can be stopped for good.",
  "The stone remembers gremlins swarming like gnats. The Gremlin King, it says, was always a cousin to the moon's fall.",
];

const STONEHENGE_DREAD = [
  "You hear a whisper from the stone circle... \"The last keeper saw it coming. Seeing changed nothing.\"",
  "A vision tears through the stone circle... the moon filling the entire sky. Someone screaming. Then silence.",
  "The air inside the stone circle is wrong. An inscription reads: \"Do not look up. Do not look up.\"",
  "You hear a whisper from the stones... \"Run. There is nowhere to run. Fly then. Fly as far as you can.\"",
  "A vision stirs inside the stone circle... prayers rising into the dark. The moon keeps coming.",
  "The carving shouts: find five braziers, keep the eternal flames burning — not the cheap kind. The Gremlin King kind.",
  "The stones say: moonstone first, braziers second. The world is a machine with missing instructions.",
];

const STONEHENGE_PANIC = [
  "You hear a whisper from the stone circle... \"Too late. Too late. Too--\"",
  "The stone circle is cracking. An inscription reads: \"We tried. We are sorry.\"",
  "A vision tears open inside the stone circle... the moon above the globe, close enough to touch. Then nothing.",
  "You hear a whisper from the stones... \"Fly. Just fly. Don't stop.\"",
  "Even the gremlins have gone quiet. And the moonstone halves feel hot through the ground.",
];

/* ── Brazier whisper lines ───────────────────────────────────────── */

/** Approaching an extinguished brazier — ancient, dormant. */
const BRAZIER_UNLIT = [
  "The brazier's iron is cold. An inscription reads: \"Five fires hold the veil. Let them go dark and the sky opens.\"",
  "The wood inside has turned to stone. Carved into the bowl: \"Do not let it go dark.\"",
  "Lichen covers the metal. Beneath it: \"Five flames, one shield. Against what comes from beyond the stars.\"",
  "A voice, not quite heard: \"We placed these five across the world. We did not tell anyone why. We should have.\"",
  "The brazier has not burned in a very long time. The air around it smells faintly of something that has no name.",
  "A newer plaque, in plain letters: \"Gremlins in the sky are a nuisance. The moon is the war. Light these five.\"",
  "Someone scratched: eternal flame — the blue kind from the Gremlin King — never goes out. Use it here.",
];

/** Approaching a lit brazier when only 1–2 total are burning — the network stirs. */
const BRAZIER_LIT_FEW = [
  "The brazier burns. Something in the flame whispers... \"One down. Four to find. The veil thins slower now.\"",
  "The flame casts no shadow. An inscription glows: \"Light all five before it arrives.\"",
  "You hear something in the crackling... \"They are watching. Whatever built the veil watches you light it back.\"",
  "The flame burns upward even when the wind says otherwise. The other four are out there, cold and waiting.",
  "Standing near the fire, you feel a warmth that isn't entirely from the flame. The brazier hums.",
  "This fire is ordinary — it will go out. An eternal flame from a Gremlin King would stay forever.",
  "Gremlins hate the cold braziers. Good luck getting gremlins to help, though.",
];

/** Approaching any brazier when 3–4 are burning — urgency rises. */
const BRAZIER_LIT_MANY = [
  "The air feels charged. An inscription: \"When four burn, the fifth must follow. The interval matters.\"",
  "The flame leans toward the sky, as if pointing at something above.",
  "The brazier flickers faster as you approach. You hear, barely: \"Almost. Almost. Do not stop now.\"",
  "You sense the other fires from here — a thread of heat connecting them across the world. One gap remains.",
  "Half-buried inscription: \"The ancients lit all five in one hour. They are not here to say what happened next.\"",
  "Three or four lit — keep going. If you have eternal flame left, save it for the last braziers.",
  "The moon feels closer when most braziers burn. Gremlins get louder too. Coincidence.",
];

/** Approaching any brazier when all 5 are burning — the shield holds. */
const BRAZIER_ALL_LIT = [
  "All five burn. The air above the globe feels heavier. Like something is pressing against it. Or pressing away.",
  "The flame is still. The inscription reads: \"You have done what we could not. We do not know if it will be enough.\"",
  "A hum runs through the ground — faint, global, old. The veil holds. For now.",
  "\"The shield is not a wall — it is a warning. Whatever it keeps out knows it is there.\"",
  "The flame burns cold. An inscription glows: \"Five fires, one breath. Hold it.\"",
  "All five braziers are lit — the moon should slow down. If you used eternal flame on each, it lasts forever.",
];

/** All five burning with eternal flame; moon stopped for good. */
const BRAZIER_ALL_ETERNAL_VICTORY = [
  "Every flame is an eternal flame. The moon has stopped. The inscription says: the world is saved.",
  "Five blue eternal flames. The Gremlin King would be proud. The moon hangs frozen in the sky.",
  "You did it. Eternal flame on all five braziers. The moon won't fall again.",
];

/** Context from Game (save + runtime brazier state). */
export interface BrazierWhisperContext {
  eternalFlameInInventory: boolean;
  allFiveEternalLit: boolean;
  moonFrozenForever: boolean;
  gremlinKingDefeated: boolean;
}

/**
 * Pick a brazier ambient whisper.
 * @param isLit   Whether the brazier being approached is currently burning.
 * @param litCount How many of the 5 braziers are currently burning.
 */
export function pickBrazierWhisper(
  isLit: boolean,
  litCount: number,
  context?: BrazierWhisperContext,
): string {
  if (context?.moonFrozenForever && litCount >= 5 && Math.random() < 0.38) {
    return BRAZIER_ALL_ETERNAL_VICTORY[
      Math.floor(Math.random() * BRAZIER_ALL_ETERNAL_VICTORY.length)
    ]!;
  }
  if (context?.allFiveEternalLit && litCount >= 5 && Math.random() < 0.32) {
    return BRAZIER_ALL_ETERNAL_VICTORY[
      Math.floor(Math.random() * BRAZIER_ALL_ETERNAL_VICTORY.length)
    ]!;
  }
  if (
    context?.gremlinKingDefeated &&
    context.eternalFlameInInventory &&
    litCount < 5 &&
    Math.random() < 0.22
  ) {
    return "You carry an eternal flame from the Gremlin King. Light a brazier with it — it never burns out.";
  }
  if (context?.eternalFlameInInventory && litCount < 5 && Math.random() < 0.18) {
    return "You have an eternal flame in your pack. Use it at a brazier — the flame stays forever.";
  }

  let pool: readonly string[];
  if (litCount >= 5)       pool = BRAZIER_ALL_LIT;
  else if (litCount >= 3)  pool = BRAZIER_LIT_MANY;
  else if (isLit)          pool = BRAZIER_LIT_FEW;
  else                     pool = BRAZIER_UNLIT;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Pick a stonehenge ambient whisper line based on moon progress. */
export function pickStonehengeWhisper(moonProgress: number): string {
  let pool: readonly string[];
  if (moonProgress >= 0.75) pool = STONEHENGE_PANIC;
  else if (moonProgress >= 0.50) pool = STONEHENGE_DREAD;
  else if (moonProgress >= 0.25) pool = STONEHENGE_UNEASY;
  else pool = STONEHENGE_CALM;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
