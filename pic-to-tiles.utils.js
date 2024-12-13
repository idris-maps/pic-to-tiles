// @ts-check

/**
 * src: https://raw.githubusercontent.com/mapbox/tilebelt/refs/heads/main/src/index.ts
 * @type {(tile: [number, number, number]) => [number, number, number, number]}
 */
const tileToBBOX = (tile) => {
  const r2d = 180 / Math.PI;

  /** @type {(x: number, z: number) => number} */
  const tile2lon = (x, z) => {
    return (x / Math.pow(2, z)) * 360 - 180;
  };
  /** @type {(y: number, z: number) => number} */
  const tile2lat = (y, z) => {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return r2d * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };

  const e = tile2lon(tile[0] + 1, tile[2]);
  const w = tile2lon(tile[0], tile[2]);
  const s = tile2lat(tile[1] + 1, tile[2]);
  const n = tile2lat(tile[1], tile[2]);
  return [w, s, e, n];
};

/**
 * src: https://raw.githubusercontent.com/mapbox/tilebelt/refs/heads/main/src/index.ts
 * @type {(tile: [number, number, number]) => [number, number, number][]}
 */
const getChildren = (tile) => {
  return [
    [tile[0] * 2, tile[1] * 2, tile[2] + 1],
    [tile[0] * 2 + 1, tile[1] * 2, tile[2] + 1],
    [tile[0] * 2 + 1, tile[1] * 2 + 1, tile[2] + 1],
    [tile[0] * 2, tile[1] * 2 + 1, tile[2] + 1],
  ];
};

/**
 * src: https://raw.githubusercontent.com/mapbox/tilebelt/refs/heads/main/src/index.ts
 * @type {(tile: [number, number, number]) => [number, number, number]}
 */
const getParent = (tile) => {
  return [tile[0] >> 1, tile[1] >> 1, tile[2] - 1];
};

const start = [512, 512, 10];

/** @type {(start: number, end: number) => number[]} */
const getAllBetween = (start, end) => {
  const res = [];
  let d = start;
  while (d <= end) {
    res.push(d);
    d++;
  }
  return res;
};

/**
 * @param {[number, number]} sizeInPx
 * @param {number} [tileSize]
 */
export const getTilesAtStartZ = (sizeInPx, tileSize = 256) => {
  const widthInTiles = sizeInPx[0] / tileSize;
  const heightInTiles = sizeInPx[1] / tileSize;
  const minX = start[0] - Math.ceil(widthInTiles / 2);
  const maxX = start[0] + Math.ceil(widthInTiles / 2);
  const minY = start[1] - Math.ceil(heightInTiles / 2);
  const maxY = start[1] + Math.ceil(heightInTiles / 2);

  const xs = getAllBetween(minX, maxX);
  const ys = getAllBetween(minY, maxY);
  /** @type {{ tile: [number,number,number], offset: [number,number] }[]} */
  const tiles = [];
  for (const y of ys) {
    for (const x of xs) {
      tiles.push({
        tile: [x, y, start[2]],
        offset: [(x - minX) * tileSize, (y - minY) * tileSize],
      });
    }
  }

  const topLeftBbox = tileToBBOX([minX, minY, start[2]]);
  const bottomRightBbox = tileToBBOX([maxX, maxY, start[2]]);
  const bbox = [
    topLeftBbox[0],
    topLeftBbox[1],
    bottomRightBbox[2],
    bottomRightBbox[3],
  ];

  return { tiles, xs, ys, z: start[2], bbox };
};

/**
 * @param {string} base
 * @param {[number, number, number]} tile
 * @param {string} [ext]
 * @returns {string}
 */
export const tileToPath = (base, tile, ext = "png") =>
  `${base}/${tile[2]}/${tile[0]}/${tile[1]}.${ext}`;

/** @type {(path: string) => [number,number, number]} */
export const pathToTile = (path) => {
  const parts = path.split(".")[0].split("/");
  const z = Number(parts.slice(-3)[0]);
  const x = Number(parts.slice(-2)[0]);
  const y = Number(parts.slice(-1)[0]);
  return [x, y, z];
};

/**
 * @param {string} cmd
 * @param {string[]} [args]
 * @returns
 */
export const runCmd = async (cmd, args = []) => {
  console.log("CMD: " + cmd + " " + args.join(" "));
  const { stdout, stderr } = await new Deno.Command(cmd, { args }).output();
  if (stderr) console.log(new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout);
};

/** @type {(file: string) => Promise<[number,number]>} */
export const getSize = async (file) =>
  JSON.parse(await runCmd("identify", ["-ping", "-format", "[%w,%h]", file]));

/** @type {(n: number) => string} */
export const pad = (n) => n < 10 ? `0${n}` : String(n);

/** @type {(path: string) => Promise<{ files: string[], dirs: string[] }>} */
const readDir = async (path) => {
  const dir = Deno.readDir(path);

  const dirs = [];
  const files = [];
  for await (const file of dir) {
    if (file.isDirectory) dirs.push(path + "/" + file.name);
    if (file.isFile) files.push(path + "/" + file.name);
  }

  const childDirs = await Promise.all(dirs.map(readDir));
  const childFiles = childDirs
    .map((d) => d.files)
    .reduce((r, d) => {
      d.forEach((file) => r.push(file));
      return r;
    }, []);

  const all = [...files, ...childFiles];

  return { files: all, dirs };
};

/** @type {(path: string) => string} */
const normalizePath = (path) => {
  const parts = path.split("/");
  parts.shift();
  return parts.join("/");
};

/** @type {(path?: string) => Promise<string[]>} */
export const readDirDeep = async (path = ".") => {
  const { files } = await readDir(path);
  return files.map(normalizePath);
};

/** @type {(outdir: string, tmpdir: string, prevZ: number) => Promise<{z:number,numX:number}>} */
export const getParentTiles = async (outdir, tmpdir, prevZ) => {
  const parentTiles = new Map();

  for (const path of await readDirDeep(outdir + "/" + prevZ)) {
    const tile = pathToTile(path);
    const _tile = tileToPath(outdir, tile, "jpg");
    const parent = getParent(tile);
    const _parent = tileToPath(outdir, parent, "jpg");
    const childs = parentTiles.get(_parent) ||
      getChildren(parent).map((d) => tileToPath(outdir, d, "jpg")).reduce(
        (r, d) => ({ ...r, [d]: false }),
        {},
      );
    if (!Object.keys(childs).includes(_tile)) {
      throw { tile, _tile, parent, _parent, childs };
    }
    childs[_tile] = true;
    parentTiles.set(_parent, childs);
  }

  const parentXs = Array.from(
    new Set(Array.from(parentTiles.keys()).map(pathToTile).map((d) => d[0])),
  );

  const z = prevZ - 1;
  const zDir = outdir + "/" + z;
  await runCmd("mkdir", [zDir]);
  for (const x of parentXs) {
    await runCmd("mkdir", [zDir + "/" + x]);
  }

  const pathToBlankTile = tmpdir + "/blank-tile.png";
  for (const [parent, children] of parentTiles.entries()) {
    const [a, b, c, d] = Object.keys(children).sort();
    await runCmd("montage", [
      ...[a, c, b, d].map((key) => children[key] ? key : pathToBlankTile),
      "-geometry",
      "128x128+0+0",
      parent,
    ]);
  }

  return { z: prevZ - 1, numX: parentXs.length };
};

/** @type {(imgSize: [number,number], tilesSize: [number,number]) => [number,number]} */
export const getOffset = ([iX, iY], [tX, tY]) => [
  Math.round((tX - iX) / 2),
  Math.round((tY - iY) / 2),
];
