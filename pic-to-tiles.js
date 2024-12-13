#!/usr/bin/env -S deno run --allow-run --allow-read

// @ts-check

import {
  getOffset,
  getParentTiles,
  getSize,
  getTilesAtStartZ,
  pad,
  runCmd,
  tileToPath,
} from "./pic-to-tiles.utils.js";

const tileSize = 256;
const inputFile = Deno.args[0];
const outdir = Deno.args[1] || inputFile.split(".").slice(0, -1).join("_");
const tmpdir = outdir + "/tmp";
const size = await getSize(inputFile);
const start = getTilesAtStartZ(size);
const tilesSize = [start.xs.length * tileSize, start.ys.length * tileSize];
const offset = getOffset(size, [
  start.xs.length * tileSize,
  start.ys.length * tileSize,
]).map((d) => `+${d}`).join("");

// folders
await runCmd("mkdir", [outdir]);
await runCmd("mkdir", [outdir + "/tmp"]);

// blank img fitting tile size
await runCmd("convert", [
  "-size",
  tilesSize.join("x"),
  "xc:white",
  `png24:${tmpdir}/blank.png`,
]);

// add original image on blank with offset to center
await runCmd("convert", [
  `${tmpdir}/blank.png`,
  inputFile,
  "-geometry",
  offset,
  "-composite",
  `${tmpdir}/tile-sized.png`,
]);

// create a blank tile
await runCmd("convert", [
  "-size",
  tileSize + "x" + tileSize,
  "xc:white",
  `png24:${tmpdir}/blank-tile.png`,
]);

// slice image into tiles
await runCmd("convert", [
  `${tmpdir}/tile-sized.png`,
  "-crop",
  `${tileSize}x${tileSize}`,
  tmpdir + "/tile-%02d.jpg",
]);

// create /{z}/{x} folder for start
await runCmd("mkdir", [outdir + "/" + start.z]);
for (const xDir of start.xs) {
  await runCmd("mkdir", [outdir + "/" + start.z + "/" + xDir]);
}

// move sliced image into /{z}/{x}/{y}.{ext} folders
let i = 0;
for (const { tile } of start.tiles) {
  await runCmd("mv", [
    `${tmpdir}/tile-${pad(i)}.jpg`,
    tileToPath(outdir, tile, "jpg"),
  ]);
  i++;
}

// create parent tiles until is only 2 tiles in width
let stop = false;
let z = start.z;
while (!stop) {
  const res = await getParentTiles(outdir, tmpdir, z);
  z = res.z;
  if (res.z === 0 || res.numX <= 2) {
    stop = true;
  }
}

// log data for rendering
console.log(JSON.stringify(
  {
    minZoom: z,
    maxZoom: start.z,
    bbox: start.bbox,
  },
  null,
  2,
));
