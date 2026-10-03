// Tune dot-grid membership to exactly 137 dots for the teardrop mark.
const W = 100, COLS = 13, ROWS = 17;
const apexY = 3, circleCy = 86, R = 46;

function count(margin, p, rowTop, rowBottom, colLeft, colRight) {
  const dots = [];
  const dx = (colRight - colLeft) / (COLS - 1);
  const dy = (rowBottom - rowTop) / (ROWS - 1);
  for (let r = 0; r < ROWS; r++) {
    const y = rowTop + r * dy;
    for (let c = 0; c < COLS; c++) {
      const x = colLeft + c * dx;
      const ex = x - 50;
      let inside;
      if (y >= circleCy) {
        inside = ex * ex + (y - circleCy) * (y - circleCy) <= (R - margin) ** 2;
      } else {
        const hw = (R - margin) * Math.pow((y - apexY) / (circleCy - apexY), p);
        inside = Math.abs(ex) <= hw;
      }
      if (inside) dots.push([+x.toFixed(2), +y.toFixed(2)]);
    }
  }
  return dots;
}

// search a few parameter combos for exactly 137
let best = null;
for (let margin = 0.5; margin <= 3.5; margin += 0.25) {
  for (let p = 0.75; p <= 1.15; p += 0.05) {
    for (let rowTop = 6; rowTop <= 12; rowTop += 0.5) {
      for (let colLeft = 3; colLeft <= 6; colLeft += 0.5) {
        const dots = count(margin, p, rowTop, 128, colLeft, 100 - colLeft);
        if (dots.length === 137) {
          // prefer rows near the top and columns near center for symmetry
          const score = Math.abs(margin - 1.5) + Math.abs(p - 0.95) + Math.abs(rowTop - 8) + Math.abs(colLeft - 4);
          if (!best || score < best.score) best = { score, margin, p, rowTop, colLeft, dots };
        }
      }
    }
  }
}

if (!best) { console.log('NO MATCH'); process.exit(1); }
const { margin, p, rowTop, colLeft, dots } = best;
console.log(`params: margin=${margin} p=${p.toFixed(2)} rowTop=${rowTop} colLeft=${colLeft} count=${dots.length}`);
console.log('export const DOTS: [number, number][] = [');
for (let i = 0; i < dots.length; i++) {
  const [x, y] = dots[i];
  console.log(`  [${x}, ${y}],${(i + 1) % 6 === 0 ? '' : ''}`);
}
console.log('];');
