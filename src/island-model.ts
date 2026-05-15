import { Genetic, GeneticOptions, Phenotype } from './genetic';

export const Migrate = {
    Fittest,
    FittestLinear,
    FittestRandom,
    Random,
    RandomLinearRank,
    Sequential,
};

export interface IslandGeneticModelOptions<T> {
    islandCount: number;
    islandMutationProbability: number;
    islandCrossoverProbability: number;
    migrationProbability: number;
    migrationFunction: (pop: Array<Phenotype<T>>) => number;
}

/**
 * Genetical island evolution model implementation
 * @see https://www.researchgate.net/figure/Parallel-genetic-algorithm-with-island-model_fig3_332715538
 * @see https://www.researchgate.net/figure/Plot-of-multi-island-genetic-algorithm_fig1_318073651
 */
export class IslandGeneticModel<T> {
    protected internalGenState = {}; /* Used for random linear */

    private populationOnContinent = false;
    private islands: Array<Genetic<T>> = [];
    private continent: Genetic<T>;
    private options: IslandGeneticModelOptions<T>;
    private geneticOptions: GeneticOptions<T>;

    /**
     * Population view across all islands (or the continent if active).
     *
     * Returns:
     *   - a **live reference** to `continent.population` when the model is
     *     in continent mode (after `moveAllToContinent`),
     *   - a **fresh concatenation** of island populations otherwise.
     *
     * Do not mutate the returned array — in continent mode mutations would
     * affect the underlying state. Use it for reading only.
     */
    get population() {
        // If population on continent get from last one
        if (this.continent.population.length) {
            return this.continent.population;
        }

        const totalPopulation: Array<Phenotype<T>> = [];

        for (let i = 0; i < this.options.islandCount; i++) {
            const island = this.islands[i];

            // Copy and reset population on island
            totalPopulation.push(...island.population);
        }

        return totalPopulation;
    }

    /**
     * Aggregated stats across islands.
     *  - fitnessPopulation: sum (total individuals)
     *  - maximumFitness:    max across islands
     *  - minimumFitness:    min across islands
     *  - averageFitness, fitnessStdDev: weighted average by population size
     */
    get stats() {
        if (this.continent.population.length) {
            return this.continent.stats;
        }

        let totalPop = 0;
        let maxFitness = -Infinity;
        let minFitness = Infinity;
        let avgAccum = 0;
        let stdAccum = 0;

        for (let i = 0; i < this.options.islandCount; i++) {
            const s = this.islands[i].stats as Record<string, number>;
            const popSize = s.fitnessPopulation || 0;
            totalPop += popSize;

            if (typeof s.maximumFitness === 'number') {
                maxFitness = Math.max(maxFitness, s.maximumFitness);
            }

            if (typeof s.minimumFitness === 'number') {
                minFitness = Math.min(minFitness, s.minimumFitness);
            }

            if (typeof s.averageFitness === 'number') {
                avgAccum += s.averageFitness * popSize;
            }

            if (typeof s.fitnessStdDev === 'number') {
                stdAccum += s.fitnessStdDev * popSize;
            }
        }

        return {
            fitnessPopulation: totalPop,
            maximumFitness: maxFitness === -Infinity ? 0 : Number(maxFitness.toFixed(4)),
            minimumFitness: minFitness === Infinity ? 0 : minFitness,
            averageFitness: totalPop ? Number((avgAccum / totalPop).toFixed(4)) : 0,
            fitnessStdDev: totalPop ? Number((stdAccum / totalPop).toFixed(4)) : 0,
        };
    }

    constructor(options: Partial<IslandGeneticModelOptions<T>>, geneticOptions: GeneticOptions<T>) {
        const defaultOptions: IslandGeneticModelOptions<T> = {
            islandCount: 6,
            islandMutationProbability: 0.5,
            islandCrossoverProbability: 0.8,
            migrationProbability: 0.05,
            migrationFunction: Migrate.Random,
        };

        this.options = { ...defaultOptions, ...options };
        this.geneticOptions = {
            optimize: (phenotypeA: Phenotype<T>, phenotypeB: Phenotype<T>) => {
                return phenotypeA.fitness >= phenotypeB.fitness;
            },
            ...geneticOptions,
            // Per-island probabilities — read from merged options, otherwise
            // `undefined` would leak in when caller skipped these fields and
            // disable mutation/crossover entirely.
            mutateProbablity: this.options.islandMutationProbability,
            crossoverProbablity: this.options.islandCrossoverProbability,
            // Per-island population size. Note: when `populationSize` does not
            // divide evenly by `islandCount`, the total across islands will
            // differ from `populationSize` by up to ±islandCount. For exact
            // budgets, pick a `populationSize` that's a multiple of
            // `islandCount`.
            populationSize: Math.round(geneticOptions.populationSize / this.options.islandCount),
        };

        this.createIslands();
        this.continent = new Genetic<T>(geneticOptions);
    }

    /**
     * Get best results from eash islands (one by one)
     * count should be more than islands count
     */
    public best(count = 5): Array<Phenotype<T>> {
        // If population on continent get from last one
        if (this.continent.population.length) {
            return this.continent.best(count);
        }

        if (count < this.options.islandCount) {
            count = this.options.islandCount;
        }

        const results: Array<Phenotype<T>> = [];
        const idxMap = {};
        let activeIsland = 0;

        while (results.length < count) {
            const island = this.islands[activeIsland];
            results.push(island.population[idxMap[activeIsland] || 0]);
            idxMap[activeIsland] = (idxMap[activeIsland] || 0) + 1;
            activeIsland++;

            // Circullar reset index
            if (activeIsland >= this.islands.length) {
                activeIsland = 0;
            }
        }

        return results.sort((a, b) => (this.geneticOptions.optimize(a, b) ? -1 : 1));
    }

    /**
     * Seed populations. Provided entities are split round-robin between
     * islands so the initial state across islands is diverse; the rest is
     * filled by each island's randomFunction.
     */
    public async seed(entities?: T[]) {
        // Reset continent-side state from any previous run so a fresh seed()
        // starts cleanly: empty continent population, flag back to islands.
        this.continent.population = [];
        this.populationOnContinent = false;

        const buckets: T[][] = [];
        for (let i = 0; i < this.options.islandCount; i++) {
            buckets.push([]);
        }
        if (entities && entities.length) {
            for (let i = 0; i < entities.length; i++) {
                buckets[i % this.options.islandCount].push(entities[i]);
            }
        }
        for (let i = 0; i < this.options.islandCount; i++) {
            await this.islands[i].seed(buckets[i]);
        }
    }
    /**
     * Breed each island
     */
    public async breed() {
        if (this.populationOnContinent) {
            return this.continent.breed();
        }

        this.migration();

        for (let i = 0; i < this.options.islandCount; i++) {
            const island = this.islands[i];

            await island.breed();
        }
    }

    /**
     * Estimate each island
     */
    public async estimate() {
        if (this.populationOnContinent) {
            return this.continent.estimate();
        }

        const tasks: Array<Promise<void>> = [];

        for (let i = 0; i < this.options.islandCount; i++) {
            const island = this.islands[i];
            tasks.push(island.estimate());
        }

        return Promise.all(tasks);
    }

    /**
     * island migrations algorithm
     *
     * Two-phase: first collect what to move (without mutating populations),
     * then apply all moves. The previous version spliced inside a
     * `for (j < island.population.length)` loop, which skipped entries and
     * could deplete an island when migrationFunction always returned 0.
     */
    private migration() {
        if (this.options.islandCount < 2) {
            return;
        }

        // Phase 1: collect migrants per source island without mutating populations.
        // Each island keeps at least one individual so subsequent breed() has
        // something to select from even with migrationProbability = 1.
        const migrants: Array<{ from: number; phenotype: Phenotype<T> }> = [];

        for (let i = 0; i < this.options.islandCount; i++) {
            const island = this.islands[i];
            const popSize = island.population.length;
            const maxLeaving = Math.max(0, popSize - 1);
            const taken = new Set<number>();
            const pickedIndexes: number[] = [];

            // Reset selector state per island so sequence-based selectors
            // (Fittest, FittestLinear, Sequential, RandomLinearRank) start
            // from scratch on each island instead of bleeding indexes
            // from the previous one.
            this.internalGenState = {};

            for (let j = 0; j < popSize && pickedIndexes.length < maxLeaving; j++) {
                if (Math.random() > this.options.migrationProbability) continue;
                let selectedIndex = this.selectOne(island);
                let guard = 0;
                while (taken.has(selectedIndex) && guard < popSize) {
                    selectedIndex = this.selectOne(island);
                    guard++;
                }
                if (taken.has(selectedIndex)) continue;
                taken.add(selectedIndex);
                pickedIndexes.push(selectedIndex);
            }

            // Splice in descending order so earlier removals don't shift later indexes.
            pickedIndexes.sort((a, b) => b - a);
            for (const idx of pickedIndexes) {
                const ph = island.population.splice(idx, 1)[0];
                if (ph) migrants.push({ from: i, phenotype: ph });
            }
        }

        // Phase 2: distribute migrants round-robin to non-source islands so
        // no destination is starved by random clustering.
        const cursors: number[] = new Array(this.options.islandCount).fill(0);
        for (const { from, phenotype } of migrants) {
            const to = this.pickDestination(from, cursors);
            this.islands[to].population.push(phenotype);
        }

        this.reorderIslands();
    }

    /**
     * Round-robin destination selection that skips the source island.
     * `cursors[from]` advances per source so destinations are spread evenly.
     */
    private pickDestination(from: number, cursors: number[]): number {
        const n = this.options.islandCount;
        if (n <= 1) return from;
        cursors[from] = cursors[from] % (n - 1);
        const offset = cursors[from]++;
        const target = (from + 1 + offset) % n;
        return target;
    }

    /**
     * Move all population to one continent
     */
    public moveAllToContinent() {
        // Population already on continent
        if (this.populationOnContinent) {
            return;
        }

        const totalPopulation: Array<Phenotype<T>> = [];

        for (let i = 0; i < this.options.islandCount; i++) {
            const island = this.islands[i];

            // Copy and reset population on island
            totalPopulation.push(...island.population);
            island.population = [];
        }

        this.continent.population = totalPopulation;
        this.populationOnContinent = true;
    }

    /**
     * Move continent population to islands
     */
    public migrateToIslands() {
        let activeIsland = 0;

        while (this.continent.population.length) {
            const phenotype = this.continent.population.pop();
            const island = this.islands[activeIsland];

            island.population.push(phenotype);
            activeIsland++;

            if (activeIsland >= this.options.islandCount) {
                activeIsland = 0;
            }
        }

        this.populationOnContinent = false;
    }

    /**
     * Create a lot of islands to use in evolution progress
     */
    private createIslands() {
        for (let i = 0; i < this.options.islandCount; i++) {
            this.islands.push(new Genetic<T>(this.geneticOptions));
        }
    }

    /**
     * Apply ordering to island populations (use after all migrations)
     */
    private reorderIslands() {
        for (let i = 0; i < this.options.islandCount; i++) {
            this.islands[i].reorderPopulation();
        }
    }

    /**
     * Select one phenotype from population
     */
    private selectOne(island: Genetic<T>): number {
        const { migrationFunction } = this.options;

        return migrationFunction.call(this, island.population);
    }

}

/**
 * Sequentially export the fittest individuals (top-1, top-2, ...) within a
 * single generation. Populations are kept sorted best-first by
 * `reorderPopulation`, so successive calls walk down the sorted list.
 *
 * The migration loop also dedups indexes per pass, so a constant-0 selector
 * (the previous implementation) would migrate only 1 individual per gen.
 */
function Fittest<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    const state = this.internalGenState as { fit?: number };
    let i = state.fit ?? 0;
    if (i >= pop.length) i = 0;
    state.fit = i + 1;
    return i;
}

function FittestLinear<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    const state = this.internalGenState as { flr?: number };
    let i = state.flr ?? 0;
    if (i >= pop.length) i = 0;
    state.flr = i + 1;
    return i;
}

function FittestRandom<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    return Math.floor(Math.random() * pop.length * 0.2);
}

function Random<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    return Math.floor(Math.random() * pop.length);
}

function RandomLinearRank<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    // See note on Genetic.RandomLinearRank — growing window 1..pop.length.
    const state = this.internalGenState as { rlr?: number };
    let rlr = state.rlr ?? 0;
    if (rlr >= pop.length) rlr = 0;
    const window = Math.min(pop.length, rlr + 1);
    state.rlr = rlr + 1;
    return Math.floor(Math.random() * window);
}

function Sequential<T>(this: IslandGeneticModel<T>, pop: Array<Phenotype<T>>): number {
    const state = this.internalGenState as { seq?: number };
    let i = state.seq ?? 0;
    if (i >= pop.length) i = 0;
    state.seq = i + 1;
    return i;
}
