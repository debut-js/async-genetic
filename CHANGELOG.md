# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-05-15

Major release. Most changes are bug fixes that were observable in long
optimization runs (island starvation, stale fitness, selection degeneracy) but
some user-facing surface was reshaped — read the **Breaking** section before
upgrading.

### Breaking

- **Public `clone` removed.** `utils.ts` and its re-export are gone. The
  library's internal deep-clone is private. If you imported `clone` from
  `async-genetic`, switch to `structuredClone` (Node 17+, modern browsers).
- **UMD global name renamed**: `window.index` → `window.asyncGenetic`. The
  previous name was a build artefact and conflicted with anything else
  exporting under `index`. Update `<script>`-tag usage.
- **`estimate()` now throws on non-finite fitness.** If your `fitnessFunction`
  returns `NaN`, `Infinity`, `undefined` or an object missing the `fitness`
  field, you'll get a descriptive error instead of a corrupted sort and a
  silent crash several lines later. Fix your fitness function or guard against
  bad backtest results explicitly.
- **`Migrate.Fittest` semantics**: was a constant `0` (which, combined with
  the new per-pass index uniqueness check, would have exported only one
  individual per generation). Now walks top-N sequentially within a
  generation — i.e. it actually migrates the fittest cohort, as the name
  suggests.
- **`Migrate.Fittest` signature**: now correctly accepts `pop` per the
  `migrationFunction: (pop) => number` interface.
- **`IslandGeneticModel` stats aggregation**: `maximumFitness` is now the
  max across islands (was: average of island maxes), `minimumFitness` is min
  (was: average of mins), `fitnessPopulation` is the sum (was: average), and
  `averageFitness`/`fitnessStdDev` are weighted by island population size.
  Anyone parsing these numbers will see different values.
- **Contract clarified — "one GA instance = one fixed fitness landscape"**:
  `fitnessFunction` must be a pure function of `entity` and external state
  captured at construction time. For walk-forward / sliding windows,
  instantiate a separate `Genetic` per data window and aggregate winners
  externally. Mutating data driving `fitnessFunction` between generations
  was never sound and is now explicitly out of scope.
- **`fittestNSurvives` default is documented as 1** (unchanged from 1.x in
  value, but the elitism mechanics are now specified): elite phenotypes
  carry their **genome** to the next generation; their `fitness`/`state`
  are reset and re-scored each `estimate()`. No more wasted cycles on
  preserved-but-stale scores; no more frozen champions on stale data.

### Fixed

- **`clone()` now deep-clones arrays and nested objects** (via
  `structuredClone` with a JSON fallback). The previous shallow
  `{...val}` returned the same reference for arrays, letting user-provided
  `crossoverFunction`/`mutationFunction` corrupt parents that still lived
  in the population.
- **`IslandGeneticModel` constructor** now reads
  `mutateProbablity`/`crossoverProbablity` from merged options instead of
  the raw `Partial<>`. Previously, omitting these fields silently leaked
  `undefined` into each island's `Genetic`, disabling mutation and
  crossover entirely.
- **`migration()` is now two-phase** (collect candidates, then apply moves)
  and uses round-robin destination selection. The previous implementation
  spliced inside a `for (j < population.length)` loop, which skipped
  entries as the length changed and could fully deplete an island whenever
  `migrationFunction` happened to return constant indexes.
- **`migration()` with `islandCount === 1`** now early-returns instead of
  blowing the stack via the previous infinite-recursive
  `getRandomIsland`.
- **`migration()` reserves at least one individual per island** so a
  high `migrationProbability` cannot empty an island and starve the
  subsequent `breed()`.
- **`IslandGeneticModel.seed()`** distributes provided entities round-robin
  across islands (was: every island got the same set, killing initial
  diversity). It also resets continent state from previous runs so a fresh
  `seed()` after a `moveAllToContinent()` no longer leaves the model in
  continent mode.
- **`Select.RandomLinearRank` / `Migrate.RandomLinearRank`**: growing
  window now starts at 1 and grows to `pop.length`. The previous version
  used `Math.random() * min(pop.length, rlr++)`, producing a zero window
  on the first call and pinning every early call to `pop[0]`.
- **`selectPair()` uses structural equality** (cached JSON key) when
  retrying the second parent pick, so two distinct-but-value-identical
  object parents are still detected as the same genome. `===` only caught
  reference equality.
- **`tryCrossover()`** logic clarified — the `crossoverFunction` check is
  hoisted into a single `doCrossover` boolean instead of repeated checks
  scattered across branches.
- **Walk-forward correctness**: with elitism re-evaluating each
  generation, there is no scenario where a "champion" from an old data
  window persists with a frozen score on new data. `population[0]` after
  `estimate()` is always the best on the current landscape.

### Added

- **Vitest test suite** with 31 unit tests covering: deep-clone isolation,
  selector distributions, deduplicate filter, elite genome carry-forward,
  fitness validation, structural-equality `selectPair`, island migration
  invariants, stats aggregation, single-island edge case,
  `Migrate.Fittest` sequential-top-N contract, continent round-trip,
  best() ordering, and convergence smoke test.
- **`npm run bench:classic | bench:island | bench:compare`** scripts run
  the original benchmark harnesses via `vite-node` (these used to require
  the now-removed `ts-node`).
- **JSDoc contracts** on `Genetic` class, `estimate()`,
  `IslandGeneticModel.population` getter, and the island per-population
  rounding caveat.

### Removed

- **`utils.ts`** and its public `clone` re-export. See Breaking.
- **`object-path-immutable`** runtime dependency. Was declared but never
  imported anywhere in `src/`.
- **Dead helpers**: `getRandomIslandIndex`, `peekPhenotye`,
  `insertPhenotype`, `cutPopulation`. Replaced by inlined logic in the
  callers.
- **rollup + buble + ts-node** and the associated rollup plugins.
- **`@rollup/plugin-buble`** transformation of `async`/`await` (no longer
  needed; esbuild handles modern syntax natively).

### Changed (non-breaking)

- All selector internal-state accesses (`FittestLinear`, `Sequential`,
  `RandomLinearRank` in both `Select` and `Migrate`) now use a uniform
  `const state = this.internalGenState as { ... }` + `??` pattern instead
  of the historical `this.internalGenState['...'] || 0` indirection.
  Behaviour is unchanged; the code is easier to read and harder to
  off-by-one.
- `IslandGeneticModel.migration()` resets `internalGenState` per-island so
  sequence-based selectors (`Fittest`, `FittestLinear`, `Sequential`,
  `RandomLinearRank`) start fresh on each island instead of carrying
  indexes from the previous one.

### Infrastructure

- **Build pipeline**: `rollup` → `vite` (`build.lib` produces ESM, CJS,
  UMD with sourcemaps).
- **Type declarations**: bundled to a single `lib/index.d.ts` via
  `vite-plugin-dts` (`rollupTypes: true`).
- **Test runner**: home-grown `node:test`/`ts-node` setup → `vitest`.
- **TypeScript**: `3.9.10` → `5.9.x`. `tsconfig.json` targets `ES2020`
  with `moduleResolution: bundler`.
- **Node tooling**: `ts-node` → `vite-node` for ad-hoc script execution
  (benches).
- **New scripts**: `test`, `test:watch`, `typecheck`, `build`,
  `bench:classic`, `bench:island`, `bench:compare`.

### Migration guide (1.x → 2.0)

1. **Stop importing `clone`** from `async-genetic`. Use `structuredClone`
   (Node 17+, all evergreen browsers) or your own helper.
2. **Update UMD consumers** to read `window.asyncGenetic` instead of
   `window.index`.
3. **Audit your `fitnessFunction`** for cases where it could return `NaN`,
   `Infinity`, or `undefined` (failed backtests, divide-by-zero, etc.).
   `estimate()` will now throw on those.
4. **If you were relying on changing data between generations of a single
   GA instance** (walk-forward, online learning, sliding windows): switch
   to one `Genetic` instance per data window. Aggregate the per-window
   winners (`population[0]` after the last `estimate()`) externally
   according to your validation strategy.
5. **If you parsed `IslandGeneticModel.stats`**: `maximumFitness`,
   `minimumFitness`, `fitnessPopulation` now reflect proper aggregations
   (max, min, sum) instead of averages.
6. **If you used `Migrate.Fittest` expecting exactly one migrant per
   generation**: it now exports the fittest cohort sequentially.
