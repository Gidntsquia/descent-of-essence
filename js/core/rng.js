(function () {
  const RNG = window.Game.RNG;

  // mulberry32: small, fast, decent-quality seeded PRNG.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  RNG.hashStringToSeed = function (str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  };

  RNG.randomSeed = function () {
    return Math.floor(Math.random() * 0xFFFFFFFF);
  };

  // Creates an independent RNG stream. Pass a number or a string (hashed).
  // Returns { seed, next(), randInt, randFloat, choice, weightedChoice, shuffle, chance }.
  RNG.create = function (seed) {
    const seedNum = typeof seed === 'number' ? seed >>> 0 : RNG.hashStringToSeed(String(seed));
    const next = mulberry32(seedNum);

    return {
      seed: seedNum,
      next,

      // inclusive on both ends
      randInt(min, max) {
        return Math.floor(next() * (max - min + 1)) + min;
      },

      randFloat(min, max) {
        return next() * (max - min) + min;
      },

      choice(arr) {
        if (!arr || arr.length === 0) return undefined;
        return arr[Math.floor(next() * arr.length)];
      },

      // items: array of anything; weightFn(item) -> number (default: item.weight || 1)
      weightedChoice(items, weightFn) {
        if (!items || items.length === 0) return undefined;
        const wf = weightFn || ((it) => (it && it.weight) || 1);
        const total = items.reduce((sum, it) => sum + wf(it), 0);
        if (total <= 0) return RNG_choiceFallback(items, next);
        let r = next() * total;
        for (const it of items) {
          r -= wf(it);
          if (r <= 0) return it;
        }
        return items[items.length - 1];
      },

      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = a[i];
          a[i] = a[j];
          a[j] = tmp;
        }
        return a;
      },

      chance(probability) {
        return next() < probability;
      }
    };
  };

  function RNG_choiceFallback(arr, next) {
    return arr[Math.floor(next() * arr.length)];
  }
})();
