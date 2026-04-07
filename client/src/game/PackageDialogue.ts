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

const PICKUP_TEMPLATES = [
  "Could you take this to {dest}? {npc} has been waiting for days!",
  "A parcel for {dest}! Handle with care, it's full of jam.",
  "Quick delivery to {dest}, please! It's a surprise birthday gift.",
  "This needs to reach {dest} before sundown. Well... before the clouds roll in.",
  "Help! My pen pal in {dest} needs this letter. And the cookies I baked.",
  "Oh, a pilot! Could you fly this to {dest}? The roads are far too winding.",
  "Special order for {dest}. {npc} will know what it is. Very hush-hush.",
  "Urgent: one jar of pickles to {dest}. Don't ask. Just deliver.",
  "This telescope belongs to {npc} in {dest}. They lent it ages ago!",
  "A care package for {dest}. Mostly socks. Everyone needs socks.",
  "Please bring this to {dest}! It's a music box — fragile!",
  "Delivery for {dest}: one scarf, hand-knitted. Took me all winter.",
  "Would you mind? {npc} in {dest} ordered a book. Three months ago.",
  "This pie needs to get to {dest} while it's still warm. Fly fast!",
  "A package of seeds for the garden in {dest}. Spring waits for no one!",
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
  "Safe and sound! {npc} sends their thanks. And this hug. From afar.",
  "The package! Quick, nobody look — it's a surprise.",
  "Thank you, brave pilot! The skies are friendlier with you in them.",
];

export interface QuestDialogue {
  npcName: string;
  pickupLine: string;
  deliveryLine: string;
}

export function generateQuestDialogue(
  seed: number,
  questIndex: number,
  destName: string,
): QuestDialogue {
  const rand = seededRandom(seed * 3571 + questIndex * 113);

  const npcName = NPC_NAMES[Math.floor(rand() * NPC_NAMES.length)];

  let pickupLine = PICKUP_TEMPLATES[Math.floor(rand() * PICKUP_TEMPLATES.length)];
  pickupLine = pickupLine.replace(/\{dest\}/g, destName).replace(/\{npc\}/g, npcName);

  let deliveryLine = DELIVERY_TEMPLATES[Math.floor(rand() * DELIVERY_TEMPLATES.length)];
  deliveryLine = deliveryLine.replace(/\{npc\}/g, npcName);

  return { npcName, pickupLine, deliveryLine };
}
