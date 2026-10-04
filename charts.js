// charts.js — tiny dependency-free SVG charts (no CDN, no build step).
//
// Each function draws into a container element and replaces whatever was
// there. Every data point carries a <title> so hovering shows the exact
// number. CHART_COLORS is a validated categorical palette (fixed hue order —
// never cycle/reassign per filter): blue, orange, aqua, yellow, magenta,
// green, violet, red. The first 3 slots clear every pairwise colorblind
// check; past slot 4, fold additional series into "Other" or facet instead
// of adding a 9th hue.

const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
  (children || []).forEach(function (c) { node.appendChild(c); });
  return node;
}

function svgText(x, y, text, cls, anchor) {
  const t = svgEl('text', { x: x, y: y, class: cls });
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = text;
  return t;
}

function svgTitle(text) {
  const t = svgEl('title', {});
  t.textContent = text;
  return t;
}

function chartEmpty(container, message) {
  container.innerHTML = '';
  container.appendChild(el('p', { class: 'chart-empty', text: message || 'Nothing to show for this period yet.' }));
}

function chartLegend(items) {
  return el('div', { class: 'chart-legend' }, items.map(function (it) {
    const sw = el('span', { class: 'sw' });
    sw.style.background = it.color;
    return el('span', {}, [sw, document.createTextNode(it.label)]);
  }));
}

// Round a maximum up to a tidy axis top, and pick an even number of steps.
function chartScale(max) {
  let top;
  if (max <= 5) {
    top = 5;
  } else {
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / pow;
    top = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  const steps = top % 4 === 0 ? 4 : 5;
  return { top: top, steps: steps, step: top / steps };
}

function chartMax(series) {
  let max = 0;
  series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
  return max;
}

// Shared frame: gridlines + y-axis labels + x-axis labels. Returns geometry.
function chartFrame(svg, labels, max, W, H) {
  const ml = 34, mr = 14, mt = 12, mb = 30;
  const iw = W - ml - mr, ih = H - mt - mb;
  const scale = chartScale(max);
  for (let i = 0; i <= scale.steps; i++) {
    const v = scale.step * i;
    const y = mt + ih - (v / scale.top) * ih;
    svg.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'chart-gridline' }));
    svg.appendChild(svgText(ml - 6, y + 3, String(v), 'chart-tick', 'end'));
  }
  return { ml: ml, mr: mr, mt: mt, mb: mb, iw: iw, ih: ih, scale: scale, W: W, H: H };
}

function xLabels(svg, labels, xAt, g) {
  const skip = Math.ceil(labels.length / 8);
  labels.forEach(function (l, i) {
    if (i % skip === 0) svg.appendChild(svgText(xAt(i), g.H - 10, l, 'chart-tick', 'middle'));
  });
}

/**
 * Line chart. opts: { labels: [..], series: [{ name, color, values: [..] }], emptyText }
 */
function lineChart(container, opts) {
  container.innerHTML = '';
  const labels = opts.labels, series = opts.series;
  const max = chartMax(series);
  if (!max) { chartEmpty(container, opts.emptyText); return; }

  const svg = svgEl('svg', { viewBox: '0 0 640 230', class: 'chart-svg', role: 'img', 'aria-label': opts.title || 'Line chart' });
  const g = chartFrame(svg, labels, max, 640, 230);
  const n = labels.length;
  const xAt = function (i) { return n === 1 ? g.ml + g.iw / 2 : g.ml + (i / (n - 1)) * g.iw; };
  const yAt = function (v) { return g.mt + g.ih - (v / g.scale.top) * g.ih; };
  xLabels(svg, labels, xAt, g);

  series.forEach(function (s) {
    const d = s.values.map(function (v, i) { return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1); }).join(' ');
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    s.values.forEach(function (v, i) {
      svg.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(v), r: '3.2', fill: '#fff', stroke: s.color, 'stroke-width': '2' }, [
        svgTitle(s.name + ' — ' + labels[i] + ': ' + v)
      ]));
    });
  });

  container.appendChild(svg);
  if (series.length > 1 || opts.showLegend) {
    container.appendChild(chartLegend(series.map(function (s) { return { label: s.name, color: s.color }; })));
  }
}

/**
 * Vertical (grouped) column chart. Same opts as lineChart.
 */
function columnChart(container, opts) {
  container.innerHTML = '';
  const labels = opts.labels, series = opts.series;
  const max = chartMax(series);
  if (!max) { chartEmpty(container, opts.emptyText); return; }

  const svg = svgEl('svg', { viewBox: '0 0 640 230', class: 'chart-svg', role: 'img', 'aria-label': opts.title || 'Column chart' });
  const g = chartFrame(svg, labels, max, 640, 230);
  const n = labels.length;
  const groupW = g.iw / n;
  const barW = Math.min(30, (groupW * 0.72) / series.length);
  const xAt = function (i) { return g.ml + i * groupW + groupW / 2; };
  xLabels(svg, labels, xAt, g);

  labels.forEach(function (label, gi) {
    series.forEach(function (s, si) {
      const v = s.values[gi];
      if (!v) return;
      const h = (v / g.scale.top) * g.ih;
      const x = g.ml + gi * groupW + (groupW - barW * series.length) / 2 + si * barW;
      svg.appendChild(svgEl('rect', { x: x, y: g.mt + g.ih - h, width: Math.max(barW - 1.5, 2), height: h, rx: '3', fill: s.color }, [
        svgTitle(s.name + ' — week of ' + label + ': ' + v)
      ]));
    });
  });

  container.appendChild(svg);
  if (series.length > 1 || opts.showLegend) {
    container.appendChild(chartLegend(series.map(function (s) { return { label: s.name, color: s.color }; })));
  }
}

/**
 * Horizontal grouped bars — good for comparing people/items.
 * opts: { labels: [..], series: [{ name, color, values }], emptyText }
 */
function hBarChart(container, opts) {
  container.innerHTML = '';
  const labels = opts.labels, series = opts.series;
  const max = chartMax(series);
  if (!labels.length || !max) { chartEmpty(container, opts.emptyText); return; }

  const W = 640, labelW = 140, valueW = 34, barH = 13, gap = 4, rowPad = 12;
  const rowH = series.length * (barH + gap) + rowPad;
  const H = labels.length * rowH + 6;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': opts.title || 'Bar chart' });
  const barArea = W - labelW - valueW;

  labels.forEach(function (label, li) {
    const y0 = li * rowH + 4;
    const short = label.length > 20 ? label.slice(0, 19) + '…' : label;
    const t = svgText(labelW - 10, y0 + (series.length * (barH + gap)) / 2 + 3, short, 'chart-label', 'end');
    t.appendChild(svgTitle(label));
    svg.appendChild(t);
    series.forEach(function (s, si) {
      const v = s.values[li];
      const w = Math.max((v / max) * barArea, v ? 3 : 0);
      const y = y0 + si * (barH + gap);
      if (v) {
        svg.appendChild(svgEl('rect', { x: labelW, y: y, width: w, height: barH, rx: '3', fill: s.color }, [svgTitle(label + ' — ' + s.name + ': ' + v)]));
      }
      svg.appendChild(svgText(labelW + w + 6, y + barH - 2, String(v), 'chart-value'));
    });
  });

  container.appendChild(svg);
  if (series.length > 1) {
    container.appendChild(chartLegend(series.map(function (s) { return { label: s.name, color: s.color }; })));
  }
}

/**
 * Donut with a legend. opts: { data: [{ label, value, color }], centerLabel, emptyText }
 */
function donutChart(container, opts) {
  container.innerHTML = '';
  const data = opts.data.filter(function (d) { return d.value > 0; });
  const total = data.reduce(function (sum, d) { return sum + d.value; }, 0);
  if (!total) { chartEmpty(container, opts.emptyText); return; }

  const r = 52, C = 2 * Math.PI * r;
  const svg = svgEl('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': opts.title || 'Donut chart' });
  svg.appendChild(svgEl('circle', { cx: 75, cy: 75, r: r, fill: 'none', stroke: '#eef0f6', 'stroke-width': '22' }));
  let acc = 0;
  data.forEach(function (d) {
    const len = (d.value / total) * C;
    svg.appendChild(svgEl('circle', {
      cx: 75, cy: 75, r: r, fill: 'none', stroke: d.color, 'stroke-width': '22',
      'stroke-dasharray': len.toFixed(2) + ' ' + (C - len).toFixed(2),
      'stroke-dashoffset': (-acc).toFixed(2),
      transform: 'rotate(-90 75 75)'
    }, [svgTitle(d.label + ': ' + d.value + ' (' + Math.round((d.value / total) * 100) + '%)')]));
    acc += len;
  });
  svg.appendChild(svgText(75, 76, String(total), 'chart-label', 'middle')).setAttribute('style', 'font-size:22px;font-weight:700');
  svg.appendChild(svgText(75, 92, opts.centerLabel || 'total', 'chart-tick', 'middle'));

  const legend = el('div', { class: 'chart-legend' }, data.map(function (d) {
    const sw = el('span', { class: 'sw' });
    sw.style.background = d.color;
    return el('span', {}, [sw, document.createTextNode(d.label + ' — ' + d.value + ' (' + Math.round((d.value / total) * 100) + '%)')]);
  }));

  container.appendChild(el('div', { class: 'chart-donut' }, [svg, legend]));
}
