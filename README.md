# Career Atlas occupations dataset

One row per US SOC occupation: federal wage and employment-projection figures,
O*NET work-context measures, two independent AI-exposure benchmarks, and a
modeled split of AI exposure into displacement and augmentation.

- `career-atlas-occupations.csv`: 524 occupations, 25 columns
- `data-dictionary.csv`: every column with its type, unit, provenance and meaning
- Built 2026-09-14 from the sources listed below

## What is unusual about it

Most "will AI take my job" datasets publish a single exposure number. This one
separates three things that usually get collapsed:

1. **Exposure** (`ai_task_score`), how much of the occupation's task list looks
   like work AI is used for, weighted by measured Claude-usage contribution per
   task rather than by guesswork.
2. **Displacement** (`displacement_risk`), the part of that we judge AI may do
   instead of the person.
3. **Augmentation** (`augmentation`), the part we judge it may do alongside them.

Displacement and augmentation always sum to exposure, so the pair reads as one
sentence about an occupation rather than as two unrelated scores.

## Read this before using the modeled columns

Three columns are our opinion: `displacement_risk`, `augmentation` and
`shield`, plus `future_proof_score` which is built from them.

The split between displacement and augmentation is made by a "shield" of legal
barriers and physical demand, with weights we chose. **There is no ground-truth
dataset of AI displacement anywhere to fit or check those weights against.** The
published benchmarks in this file measure exposure, not displacement, so scoring
our discount against them would be circular.

We have run the one out-of-sample test available to us, against BLS revising its
own projections between cycles, and it came back null: displacement risk
explains about 2% of the variance in those revisions. That is written up at
https://careeratlas.dev/writing/bls-revision-test.

Treat the sourced columns as federal statistics. Treat the modeled columns as a
documented argument you are free to disagree with. The `provenance` column in
the data dictionary tells you which is which for every field.

## Coverage

Blank means not published, never zero. Nothing here is imputed to fill a gap.

- `median_annual_wage_usd`: 524 of 524 (100%)
- `wage_pct25`/`wage_pct75`: 503 of 524 (96%)
- `projected_growth_pct`: 504 of 524 (96%)
- `annual_openings`: 504 of 524 (96%)
- `physical_demand`: 453 of 524 (86%)
- `ai_task_score`: 503 of 524 (96%)
- `displacement_risk`: 503 of 524 (96%)
- `microsoft_ai_applicability_percentile`: 469 of 524 (90%)

## Grain, and the mistake to avoid

**One row per SOC code.** Career Atlas itself lists about 1,000 job titles over
these 524 codes, because "Pediatric Nurses" is a useful thing to browse for even
though BLS publishes it as part of Registered Nurses. Every figure here is
published per code, so aggregating over titles would weight an occupation by how
many sub-titles a website happened to write. If you join this to a title-level
list, dedupe by `soc_code` before computing anything.

`ai_exposure_percentile` and the two benchmark percentiles are **ranks**, uniform
by construction. They are the right thing to compare across methods and the
wrong thing to put in a weighted average. Use `ai_task_score` for that.

## Sources and attribution

| Source | Used for | Licence |
|---|---|---|
| BLS Occupational Employment and Wage Statistics, May 2025 | wages, employment | Public domain (US Government work) |
| BLS Employment Projections 2025-2035 | growth, annual openings | Public domain (US Government work) |
| O*NET 30.3, National Center for O*NET Development | job zone, work context, tasks, bright outlook | CC BY 4.0 |
| Microsoft "Working with AI" | `microsoft_ai_applicability_percentile` | CC BY 4.0 |
| Anthropic Economic Index | `anthropic_claude_usage_percentile`, task weighting | CC BY |
| 2018 SOC, US Office of Management and Budget | `soc_code` | Public domain |

This dataset contains information from O*NET 30.3 by the National Center for
O*NET Development under CC BY 4.0, from Microsoft's "Working with AI" under
CC BY 4.0, and from the Anthropic Economic Index under CC BY. Those inputs have
been transformed: joined to SOC codes, rescaled, and combined into the derived
and modeled columns described above.

## Licence

CC BY 4.0, inherited from the O*NET and benchmark inputs. Use it for anything,
including commercially, with attribution.

Suggested citation:

> Career Atlas occupations dataset (2026-09-14). https://careeratlas.dev. Derived from BLS OEWS
> May 2025, BLS Employment Projections 2025-2035, O*NET 30.3, Microsoft
> "Working with AI", and the Anthropic Economic Index. CC BY 4.0.

## Known limits

- `physical_demand` is blank for the codes O*NET publishes no work context for.
  The model treats a missing reading as unknown rather than as zero; this file
  leaves it blank so you can make your own choice.
- `remote_proxy` measures how desk-based work is, not who actually works
  remotely. No federal dataset publishes the latter per occupation.
- The modeled columns cannot distinguish analytical desk work from work AI
  actually does. Life-science occupations score higher on `displacement_risk`
  than we think is right, and that failure is documented rather than fixed.
- SOC codes change between revisions. This is 2018 SOC for wages and projections
  and 2019 SOC for O*NET, reconciled where they differ.

## About this repository

This repo holds the published dataset and nothing else. It is generated from
the Career Atlas source tree, which is not public, and synced here deliberately
rather than automatically.

`build-dataset.mjs` is the exact script that produced the CSV, copied here so
you can read how every column was derived. **It does not run in this
repository**, because it imports the site's data modules. If you need to verify
something the data dictionary does not answer, open an issue.

Corrections are welcome as issues. If you find a number that disagrees with the
federal source it claims, that is a bug and worth reporting: the whole point of
the provenance labelling is that claims like these can be checked.
