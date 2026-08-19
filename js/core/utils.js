(function () {
  const U = window.Game.Utils;

  U.key = function (x, y) {
    return x + ',' + y;
  };

  U.parseKey = function (k) {
    const parts = k.split(',');
    return { x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) };
  };

  U.manhattan = function (ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };

  U.isAdjacent = function (ax, ay, bx, by) {
    return U.manhattan(ax, ay, bx, by) === 1;
  };

  U.clamp = function (val, min, max) {
    return Math.max(min, Math.min(max, val));
  };

  U.deepClone = function (obj) {
    return JSON.parse(JSON.stringify(obj));
  };

  let uidCounter = 0;
  U.uid = function (prefix) {
    uidCounter += 1;
    return (prefix || 'id') + '_' + uidCounter + '_' + Math.floor(Math.random() * 1e6);
  };

  U.inBounds = function (x, y, w, h) {
    return x >= 0 && x < w && y >= 0 && y < h;
  };

  // Returns [{direction, x, y}, ...] for the 4 cardinal neighbors of (x,y).
  U.neighborCells = function (x, y) {
    const C = window.Game.Constants;
    return Object.keys(C.DIRECTION_VECTORS).map((dir) => {
      const v = C.DIRECTION_VECTORS[dir];
      return { direction: dir, x: x + v.dx, y: y + v.dy };
    });
  };
})();
