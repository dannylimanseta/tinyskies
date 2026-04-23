const fs = require("fs");
const buf = fs.readFileSync("public/3D/whale.glb");
const jsonLen = buf.readUInt32LE(12);
const jsonStr = buf.toString("utf8", 20, 20 + jsonLen);
const json = JSON.parse(jsonStr);
json.nodes.forEach((n, i) => {
    console.log(`Node ${i}: ${n.name}, children: ${n.children}`);
});
