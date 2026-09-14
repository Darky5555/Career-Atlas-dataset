/* ---------------------------------------------------------------------------
 * PUBLISHED FOR INSPECTION, NOT FOR EXECUTION.
 *
 * This is the exact script that produced career-atlas-occupations.csv, copied
 * here unmodified below this header so you can read how every column was
 * derived. It does NOT run in this repository: it imports the Career Atlas
 * site's data modules through Vite, and that source tree is not public.
 *
 * What you can verify without it: every "sourced" column comes from a public
 * federal release named in the README, and the derived columns are described
 * with their formulas in data-dictionary.csv. What you cannot verify from this
 * repo alone is the intermediate join. If that matters for your use, open an
 * issue and ask; the answer is not a secret, it is just not packaged here.
 * ------------------------------------------------------------------------- */

/**
 * build-dataset.mjs: the public dataset.
 *
 * Emits one row per SOC occupation with the federal figures the site carries
 * and the model output it derives, plus a data dictionary and a README. The
 * point is that someone can use the numbers without using the site, and check
 * them without asking us.
 *
 * Two rules shape the output.
 *
 * One row per SOC code, never per catalogue title. The catalogue lists ~1,000
 * titles over ~524 codes because that is a browsing convenience; every figure
 * here is published per code, so a title-level export would silently weight an
 * occupation by how many sub-titles we happened to write.
 *
 * Sourced and modeled columns are never mixed without saying which is which.
 * The data dictionary carries a provenance class for every column, and the
 * three columns that are our opinion rather than anyone's measurement say so in
 * their own description. A dataset that lets someone mistake our shield for a
 * federal statistic would be worse than publishing nothing.
 *
 * Run: node scripts/build-dataset.mjs
 * Output: dataset/ at the repo root, and a copy under dist/data/ when dist
 * exists, so the files have a stable download URL as well as a GitHub one.
 */
import { createServer } from 'vite';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignPageSlugs } from './lib/pageSlugs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'dataset');
const BASE = 'https://careeratlas.dev';
const TODAY = new Date().toISOString().slice(0, 10);

/** RFC 4180: quote anything containing a comma, quote or newline. */
const cell = v => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (cols, rows) =>
  [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';

/** Round without turning an absent value into a zero. */
const r2 = v => (v == null ? null : Math.round(v * 1000) / 1000);

/**
 * Every column, with the provenance class that decides how much weight a user
 * should put on it. This is the file a careful person reads first.
 *
 *   sourced   published by a federal agency, used as-is
 *   derived   computed by us from sourced inputs, reproducible
 *   modeled   our judgement, with no external dataset to check it against
 */
const DICTIONARY = [
  ['soc_code', 'string', 'SOC 2018 code', 'sourced', 'US Standard Occupational Classification, the join key for every other public dataset here.'],
  ['occupation_title', 'string', '', 'derived', 'The title Career Atlas publishes this code under. Where several titles share a code, this is the one that owns the page; the official O*NET title wins where we carry an occupation by that name.'],
  ['career_atlas_url', 'string', 'URL', 'derived', 'Page for this occupation, where every number below is shown with its provenance label.'],
  ['median_annual_wage_usd', 'integer', 'USD/year', 'sourced', 'BLS OEWS, May 2025 reference period. Blank where BLS does not publish a national figure.'],
  ['wage_pct10', 'integer', 'USD/year', 'sourced', 'BLS OEWS 10th percentile. Blank where not published; we do NOT substitute an estimate.'],
  ['wage_pct25', 'integer', 'USD/year', 'sourced', 'BLS OEWS 25th percentile. Blank where not published.'],
  ['wage_pct75', 'integer', 'USD/year', 'sourced', 'BLS OEWS 75th percentile. Blank where not published.'],
  ['wage_pct90', 'integer', 'USD/year', 'sourced', 'BLS OEWS 90th percentile. Blank where not published.'],
  ['wage_source', 'string', '', 'sourced', 'Which release the wage came from. "onet-wage-2025" marks the two occupations absent from the national OEWS file, where O*NET OnLine aggregates state-level BLS data instead.'],
  ['employment', 'integer', 'jobs', 'sourced', 'Total US employment, BLS OEWS.'],
  ['projected_growth_pct', 'number', 'percent over 10 years', 'sourced', 'BLS Employment Projections 2025-2035, percent change in employment. Negative means projected decline.'],
  ['annual_openings', 'integer', 'openings/year', 'sourced', 'BLS Employment Projections 2025-2035, average annual openings including replacement demand. Blank where BLS publishes none; we do NOT substitute an estimate in this file.'],
  ['job_zone', 'integer', '1-5', 'sourced', 'O*NET Job Zone, preparation required. 1 is little or none, 5 is extensive.'],
  ['bright_outlook', 'boolean', '', 'sourced', 'O*NET Bright Outlook flag, 2025.'],
  ['remote_proxy', 'number', '1-5', 'derived', 'How desk-based and digital the work is, computed from O*NET work-context items. Higher means more remote-capable. This is a proxy, not a measurement of who actually works remotely.'],
  ['physical_demand', 'number', '1-5', 'derived', 'Physical demand, computed from O*NET work-context items. Higher means more physical. Blank where O*NET publishes no work context for the code.'],
  ['ai_task_score', 'number', '0-1', 'derived', 'Share of the occupation\'s task list that looks like work AI is used for, weighted by measured Claude-usage contribution per task and adjusted by two work-context signals. A magnitude, safe to compute with.'],
  ['ai_exposure_percentile', 'number', '0-100', 'derived', 'Percentile rank of ai_task_score across occupations. A RANK, uniform by construction. Comparable to the benchmark percentiles below; do NOT feed it into a weighted composite.'],
  ['displacement_risk', 'number', '0-1', 'modeled', 'OUR OPINION. ai_task_score x (1 - shield). The part of the exposed work we judge AI may do INSTEAD of the person. No ground-truth dataset exists to fit or check this against; see the README.'],
  ['augmentation', 'number', '0-1', 'modeled', 'OUR OPINION. ai_task_score x shield. The part we judge AI may do ALONGSIDE the person. displacement_risk + augmentation = ai_task_score by construction.'],
  ['shield', 'number', '0-1', 'modeled', 'OUR OPINION. 0.6 x (legal_barrier_level / 3) + 0.4 x normalized physical demand, capped at 0.85. The weights are ours and are not derived from anything.'],
  ['legal_barrier_level', 'integer', '0-3', 'modeled', 'How far the law pins this work to a named human. 0 none, 1 credential expected, 2 licence or named officer required, 3 a named human must personally sign. Mostly derived from entry routes, with curated exceptions.'],
  ['future_proof_score', 'integer', '0-100', 'modeled', 'OUR OPINION. Weighted blend of growth outlook, automation resistance, salary ceiling, workforce retention and skill demand. Weights are ours and published on the methodology page.'],
  ['microsoft_ai_applicability_percentile', 'number', '0-100', 'sourced', 'Microsoft "Working with AI" applicability score, percentile within its own distribution. An independent benchmark, not an input to our displacement model.'],
  ['anthropic_claude_usage_percentile', 'number', '0-100', 'sourced', 'Anthropic Economic Index Claude-usage intensity, percentile within its own distribution. Independent benchmark.'],
];

const vite = await createServer({ root: ROOT, logLevel: 'warn', server: { middlewareMode: true }, appType: 'custom' });
try {
  const derive = await vite.ssrLoadModule('/src/data/derive.js');
  await derive.ensureDetail();
  const { dedupeByCode } = await vite.ssrLoadModule('/src/data/socOwners.js');
  const { displacementRisk } = await vite.ssrLoadModule('/src/models/displacement.js');
  const { gatingLevel } = await vite.ssrLoadModule('/src/data/gating.js');
  const { getAiExposure } = await vite.ssrLoadModule('/src/models/estimates.js');
  const bench = await vite.ssrLoadModule('/src/models/aiBenchmarks.js');
  await bench.ensureBenchmarks();
  const { slugForCode } = assignPageSlugs(derive.ALL_LEAVES);

  const rows = [];
  for (const leaf of dedupeByCode(derive.ALL_LEAVES)) {
    const d = leaf.data;
    const slug = slugForCode.get(d.code);
    const risk = displacementRisk(d);
    const b = bench.getBenchmarks(d.code) || {};
    const exposure = getAiExposure(d);
    rows.push({
      soc_code: d.code,
      occupation_title: d.name,
      career_atlas_url: slug ? `${BASE}/careers/${slug}` : '',
      median_annual_wage_usd: d.med ?? null,
      wage_pct10: d.pct10 ?? null,
      wage_pct25: d.pct25 ?? null,
      wage_pct75: d.pct75 ?? null,
      wage_pct90: d.pct90 ?? null,
      wage_source: d._provenance?.med ?? '',
      employment: d.employment ?? null,
      projected_growth_pct: d._provenance?.growth ? d.growth : null,
      annual_openings: d._provenance?.openings ? d.openings : null,
      job_zone: d.jobZone ?? null,
      bright_outlook: d.brightOutlook ? 'true' : 'false',
      remote_proxy: r2(d.remoteProxy),
      physical_demand: r2(d.physicalDemand),
      ai_task_score: r2(risk?.taskScore),
      ai_exposure_percentile: exposure?.pct ?? null,
      displacement_risk: r2(risk?.risk),
      augmentation: r2(risk?.augmentation),
      shield: r2(risk?.shield),
      legal_barrier_level: gatingLevel(d),
      future_proof_score: derive.futureProofScore(leaf),
      microsoft_ai_applicability_percentile: b.msP ?? null,
      anthropic_claude_usage_percentile: b.anP ?? null,
    });
  }
  rows.sort((a, b) => a.soc_code.localeCompare(b.soc_code));

  const cols = DICTIONARY.map(d => d[0]);

  /* ---- Invariants ------------------------------------------------------
   * Checked before writing, because a dataset published with a silent error
   * is worse than one that failed to build: it gets mirrored, cited and
   * joined against, and the copies do not get the correction.            */
  const fail = [];
  const dupes = cols.filter((c, i) => cols.indexOf(c) !== i);
  if (dupes.length) fail.push(`duplicate columns: ${dupes.join(', ')}`);

  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.soc_code)) fail.push(`duplicate soc_code ${r.soc_code}, the file must be one row per code`);
    seen.add(r.soc_code);
    const unknown = Object.keys(r).filter(k => !cols.includes(k));
    if (unknown.length) fail.push(`${r.soc_code} carries columns absent from the dictionary: ${unknown.join(', ')}`);

    // The split is the dataset's headline claim, so it is checked rather
    // than trusted. Tolerance is one rounding step on three decimals.
    const { displacement_risk: d, augmentation: a, ai_task_score: t } = r;
    if (d != null && a != null && t != null && Math.abs(d + a - t) > 0.0025) {
      fail.push(`${r.soc_code}: displacement ${d} + augmentation ${a} != task score ${t}`);
    }
    for (const [col, lo, hi] of [
      ['ai_task_score', 0, 1], ['displacement_risk', 0, 1], ['augmentation', 0, 1],
      ['shield', 0, 1], ['ai_exposure_percentile', 0, 100], ['legal_barrier_level', 0, 3],
      ['future_proof_score', 0, 100],
    ]) {
      const v = r[col];
      if (v != null && (v < lo || v > hi)) fail.push(`${r.soc_code}: ${col} = ${v}, outside ${lo}..${hi}`);
    }
  }

  // A drop in coverage is how a broken upstream join reaches the public.
  const prev = resolve(OUT, 'career-atlas-occupations.csv');
  if (existsSync(prev)) {
    const before = readFileSync(prev, 'utf8').trim().split('\n').length - 1;
    if (rows.length < before) {
      console.warn(`\n  !! occupation count fell ${before} -> ${rows.length} since the last build.`);
      console.warn('     Check the upstream data before publishing; mirrors do not get corrections.');
    }
  }

  if (fail.length) {
    console.error('build-dataset: refusing to write, invariants failed:');
    for (const f of fail.slice(0, 20)) console.error('  ' + f);
    if (fail.length > 20) console.error(`  ...and ${fail.length - 20} more`);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, 'career-atlas-occupations.csv'), toCsv(cols, rows), 'utf8');
  await writeFile(
    resolve(OUT, 'data-dictionary.csv'),
    toCsv(['column', 'type', 'unit', 'provenance', 'description'],
      DICTIONARY.map(([column, type, unit, provenance, description]) =>
        ({ column, type, unit, provenance, description }))),
    'utf8');

  // Coverage, stated in the README rather than left for the user to discover.
  const filled = c => rows.filter(r => r[c] != null && r[c] !== '').length;
  const cov = Object.fromEntries(cols.map(c => [c, filled(c)]));

  await writeFile(resolve(OUT, 'README.md'), readme(rows.length, cov), 'utf8');

  // Stable download URLs alongside the GitHub copy.
  if (existsSync(resolve(ROOT, 'dist'))) {
    await mkdir(resolve(ROOT, 'dist', 'data'), { recursive: true });
    for (const f of ['career-atlas-occupations.csv', 'data-dictionary.csv', 'README.md', 'LICENSE.txt']) {
      await copyFile(resolve(OUT, f), resolve(ROOT, 'dist', 'data', f));
    }
  }

  console.log(`build-dataset: ${rows.length} occupations -> dataset/`);
  console.log(`  wage ${cov.median_annual_wage_usd}, growth ${cov.projected_growth_pct}, openings ${cov.annual_openings}, displacement ${cov.displacement_risk}, benchmark ${cov.microsoft_ai_applicability_percentile}`);
} finally {
  await vite.close();
}

function readme(n, cov) {
  const pct = c => `${cov[c]} of ${n} (${Math.round(cov[c] / n * 100)}%)`;
  return `# Career Atlas occupations dataset

One row per US SOC occupation: federal wage and employment-projection figures,
O*NET work-context measures, two independent AI-exposure benchmarks, and a
modeled split of AI exposure into displacement and augmentation.

- \`career-atlas-occupations.csv\`: ${n} occupations, ${DICTIONARY.length} columns
- \`data-dictionary.csv\`: every column with its type, unit, provenance and meaning
- Built ${TODAY} from the sources listed below

## What is unusual about it

Most "will AI take my job" datasets publish a single exposure number. This one
separates three things that usually get collapsed:

1. **Exposure** (\`ai_task_score\`), how much of the occupation's task list looks
   like work AI is used for, weighted by measured Claude-usage contribution per
   task rather than by guesswork.
2. **Displacement** (\`displacement_risk\`), the part of that we judge AI may do
   instead of the person.
3. **Augmentation** (\`augmentation\`), the part we judge it may do alongside them.

Displacement and augmentation always sum to exposure, so the pair reads as one
sentence about an occupation rather than as two unrelated scores.

## Read this before using the modeled columns

Three columns are our opinion: \`displacement_risk\`, \`augmentation\` and
\`shield\`, plus \`future_proof_score\` which is built from them.

The split between displacement and augmentation is made by a "shield" of legal
barriers and physical demand, with weights we chose. **There is no ground-truth
dataset of AI displacement anywhere to fit or check those weights against.** The
published benchmarks in this file measure exposure, not displacement, so scoring
our discount against them would be circular.

We have run the one out-of-sample test available to us, against BLS revising its
own projections between cycles, and it came back null: displacement risk
explains about 2% of the variance in those revisions. That is written up at
${BASE}/writing/bls-revision-test.

Treat the sourced columns as federal statistics. Treat the modeled columns as a
documented argument you are free to disagree with. The \`provenance\` column in
the data dictionary tells you which is which for every field.

## Coverage

Blank means not published, never zero. Nothing here is imputed to fill a gap.

- \`median_annual_wage_usd\`: ${pct('median_annual_wage_usd')}
- \`wage_pct25\`/\`wage_pct75\`: ${pct('wage_pct25')}
- \`projected_growth_pct\`: ${pct('projected_growth_pct')}
- \`annual_openings\`: ${pct('annual_openings')}
- \`physical_demand\`: ${pct('physical_demand')}
- \`ai_task_score\`: ${pct('ai_task_score')}
- \`displacement_risk\`: ${pct('displacement_risk')}
- \`microsoft_ai_applicability_percentile\`: ${pct('microsoft_ai_applicability_percentile')}

## Grain, and the mistake to avoid

**One row per SOC code.** Career Atlas itself lists about 1,000 job titles over
these ${n} codes, because "Pediatric Nurses" is a useful thing to browse for even
though BLS publishes it as part of Registered Nurses. Every figure here is
published per code, so aggregating over titles would weight an occupation by how
many sub-titles a website happened to write. If you join this to a title-level
list, dedupe by \`soc_code\` before computing anything.

\`ai_exposure_percentile\` and the two benchmark percentiles are **ranks**, uniform
by construction. They are the right thing to compare across methods and the
wrong thing to put in a weighted average. Use \`ai_task_score\` for that.

## Sources and attribution

| Source | Used for | Licence |
|---|---|---|
| BLS Occupational Employment and Wage Statistics, May 2025 | wages, employment | Public domain (US Government work) |
| BLS Employment Projections 2025-2035 | growth, annual openings | Public domain (US Government work) |
| O*NET 30.3, National Center for O*NET Development | job zone, work context, tasks, bright outlook | CC BY 4.0 |
| Microsoft "Working with AI" | \`microsoft_ai_applicability_percentile\` | CC BY 4.0 |
| Anthropic Economic Index | \`anthropic_claude_usage_percentile\`, task weighting | CC BY |
| 2018 SOC, US Office of Management and Budget | \`soc_code\` | Public domain |

This dataset contains information from O*NET 30.3 by the National Center for
O*NET Development under CC BY 4.0, from Microsoft's "Working with AI" under
CC BY 4.0, and from the Anthropic Economic Index under CC BY. Those inputs have
been transformed: joined to SOC codes, rescaled, and combined into the derived
and modeled columns described above.

## Licence

CC BY 4.0, inherited from the O*NET and benchmark inputs. Use it for anything,
including commercially, with attribution.

Suggested citation:

> Career Atlas occupations dataset (${TODAY}). ${BASE}. Derived from BLS OEWS
> May 2025, BLS Employment Projections 2025-2035, O*NET 30.3, Microsoft
> "Working with AI", and the Anthropic Economic Index. CC BY 4.0.

## Known limits

- \`physical_demand\` is blank for the codes O*NET publishes no work context for.
  The model treats a missing reading as unknown rather than as zero; this file
  leaves it blank so you can make your own choice.
- \`remote_proxy\` measures how desk-based work is, not who actually works
  remotely. No federal dataset publishes the latter per occupation.
- The modeled columns cannot distinguish analytical desk work from work AI
  actually does. Life-science occupations score higher on \`displacement_risk\`
  than we think is right, and that failure is documented rather than fixed.
- SOC codes change between revisions. This is 2018 SOC for wages and projections
  and 2019 SOC for O*NET, reconciled where they differ.
`;
}
