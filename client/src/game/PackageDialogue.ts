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
};

export function getNpcPortraitUrl(npcName: string): string {
  const file = NPC_PORTRAIT_FILES[npcName];
  return file ? `/npc/${file}` : "";
}

const PICKUP_TEMPLATES = [
  "Could you take this to {dest}? {receiver} has been waiting for days!",
  "A parcel for {dest}! Handle with care, it's full of jam.",
  "Quick delivery to {dest}, please! It's a surprise birthday gift.",
  "This needs to reach {dest} before sundown. Well... before the clouds roll in.",
  "Help! My pen pal in {dest} needs this letter. And the cookies I baked.",
  "Oh, a pilot! Could you fly this to {dest}? The roads are far too winding.",
  "Special order for {dest}. {receiver} will know what it is. Very hush-hush.",
  "Urgent: one jar of pickles to {dest}. Don't ask. Just deliver.",
  "This telescope belongs to {receiver} in {dest}. They lent it ages ago!",
  "A care package for {dest}. Mostly socks. Everyone needs socks.",
  "Please bring this to {dest}! It's a music box — fragile!",
  "Delivery for {dest}: one scarf, hand-knitted. Took me all winter.",
  "Would you mind? {receiver} in {dest} ordered a book. Three months ago.",
  "This pie needs to get to {dest} while it's still warm. Fly fast!",
  "A package of seeds for the garden in {dest}. Spring waits for no one!",
  "Oh thank goodness, a pilot! {receiver} in {dest} is expecting medicine.",
  "It's just a little box of chocolates for {receiver}. Don't eat any!",
  "Take this map to {dest}. {receiver} drew the first half, I drew the rest.",
  "Emergency! The choir in {dest} needs new sheet music by tonight!",
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
];

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
): QuestDialogue {
  const rand = seededRandom(seed * 3571 + questIndex * 113);

  const senderIdx = Math.floor(rand() * NPC_NAMES.length);
  let receiverIdx = Math.floor(rand() * NPC_NAMES.length);
  if (receiverIdx === senderIdx) {
    receiverIdx = (receiverIdx + 1) % NPC_NAMES.length;
  }
  const senderName = NPC_NAMES[senderIdx];
  const receiverName = NPC_NAMES[receiverIdx];

  let pickupLine = PICKUP_TEMPLATES[Math.floor(rand() * PICKUP_TEMPLATES.length)];
  pickupLine = pickupLine
    .replace(/\{dest\}/g, destName)
    .replace(/\{receiver\}/g, receiverName);

  let deliveryLine = DELIVERY_TEMPLATES[Math.floor(rand() * DELIVERY_TEMPLATES.length)];
  deliveryLine = deliveryLine.replace(/\{sender\}/g, senderName);

  return { senderName, receiverName, pickupLine, deliveryLine };
}

/** Cosy hot-air-balloon NPC greetings (reuse same NPC names + portraits as package quest). */
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

/**
 * Random NPC + greeting line for balloon proximity (same portrait pool as package quests).
 * Uses Math.random() — the old seeded LCG often produced the same first draw (e.g. Old Barnaby)
 * for nearby seeds; balloon lines don’t need to match across clients.
 */
export function pickBalloonGreeting(
  _seed: number,
  _balloonIndex: number,
  _salt: number,
): { npcName: string; line: string } {
  const npcName = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]!;
  const line = BALLOON_GREETINGS[Math.floor(Math.random() * BALLOON_GREETINGS.length)]!;
  return { npcName, line };
}
