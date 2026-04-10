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

const PICKUP_TEMPLATES_URGENT = [
  "Please, get this to {dest} quickly. Something terrible is coming.",
  "{receiver} in {dest} needs this. I have a bad feeling about tonight.",
  "Hurry — take this to {dest} before the sky gets any stranger.",
  "This package must reach {dest}. {receiver} is preparing for the worst.",
  "I packed emergency supplies for {dest}. Please don't delay.",
  "The moon is too close. {receiver} needs this — it might be our last chance.",
  "Get this to {dest}, pilot. And if I were you, I wouldn't linger.",
  "Something is very wrong. Take this to {receiver} in {dest}, quickly.",
  "Don't ask what's inside. Just get it to {dest}. Time is running out.",
  "I promised {receiver} I'd send help. You're all I've got, pilot.",
];

const PICKUP_TEMPLATES_FRANTIC = [
  "PLEASE! Take this to {dest} before it's too late!",
  "No time to explain — fly this to {dest} NOW!",
  "Forget the small talk — {receiver} needs this or we're all done for!",
  "{dest}! Go! GO! {receiver} is counting on you!",
  "I can see it coming. Just take this and fly to {dest} — FAST!",
  "This might be the last delivery anyone ever makes. Get it to {dest}!",
  "My hands are shaking. Please — {receiver} in {dest} — hurry!",
  "If {dest} doesn't get this, nothing else matters anyway.",
  "Take it! Take it and fly! Don't look up, just fly to {dest}!",
  "There's no time! {receiver} needs this NOW — the sky is falling!",
];

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

const DELIVERY_TEMPLATES_URGENT = [
  "Thank goodness. Have you seen the moon? I'm scared, pilot.",
  "You made it. I wasn't sure anyone would, with the sky like that.",
  "This might help us prepare. Thank you — and be careful out there.",
  "I owe you. Now get somewhere safe. I don't trust that moon.",
  "Finally! Tell {sender} to get underground. Something is coming.",
  "Thank you. I hope this isn't the last delivery I ever receive.",
  "You're braver than most. The others have stopped flying entirely.",
  "{sender} always keeps their promises. Even now. Bless them.",
  "We needed this. The village is frightened. Stay safe, pilot.",
  "I almost didn't expect you'd come. The world feels like it's ending.",
];

const DELIVERY_TEMPLATES_FRANTIC = [
  "FINALLY! Now get out of here — there's no time!",
  "You're insane for still flying! Thank you — now LEAVE!",
  "It doesn't matter anymore. Nothing matters. But... thank you.",
  "I can't believe you made it. The sky is falling apart!",
  "Take shelter! Forget more deliveries — save yourself!",
  "Tell {sender} I said goodbye. And thank you. Now GO!",
  "You beautiful, crazy pilot. Now run. RUN!",
  "The ground is shaking. Thank you — now please, get somewhere safe!",
  "I thought I'd die waiting. Thank you. I think we're all going to die anyway.",
  "Bless you, pilot. If we survive this, I owe you everything.",
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
  const line = PANIC_LINES[Math.floor(Math.random() * PANIC_LINES.length)]!;
  return { npcName, line };
}
